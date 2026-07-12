package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"harmony-api/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// wsTicketData es el payload de un ticket de un solo uso para conexión WS.
type wsTicketData struct {
	UserID    uint
	CompanyID uint
	Role      string
	DBName    string
	ExpiresAt time.Time
}

var wsTickets sync.Map

// StoreWSTicket guarda un ticket con TTL de 30 segundos (llamado desde handlers/auth.go).
func StoreWSTicket(ticket string, userID, companyID uint, role, dbName string) {
	wsTickets.Store(ticket, wsTicketData{
		UserID: userID, CompanyID: companyID, Role: role, DBName: dbName,
		ExpiresAt: time.Now().Add(30 * time.Second),
	})
}

// consumeWSTicket valida y elimina el ticket (uso único).
func consumeWSTicket(ticket string) (wsTicketData, bool) {
	v, ok := wsTickets.LoadAndDelete(ticket)
	if !ok {
		return wsTicketData{}, false
	}
	d := v.(wsTicketData)
	if time.Now().After(d.ExpiresAt) {
		return wsTicketData{}, false
	}
	return d, true
}

// A-03: janitor que purga tickets emitidos pero nunca consumidos (el cliente
// que pide un ticket y no abre el WS dejaría la entrada para siempre → memory leak).
func init() {
	go func() {
		t := time.NewTicker(1 * time.Minute)
		defer t.Stop()
		for range t.C {
			now := time.Now()
			wsTickets.Range(func(k, v any) bool {
				if now.After(v.(wsTicketData).ExpiresAt) {
					wsTickets.Delete(k)
				}
				return true
			})
		}
	}()
}

const (
	maxConnectionsPerHub = 5000
	sendBufferSize       = 64 // bajado de 256 para reducir huella de memoria

	// A-05: parámetros de keepalive y límites de la conexión WebSocket.
	writeWait      = 10 * time.Second // plazo para completar una escritura
	pongWait       = 60 * time.Second // tiempo máximo sin recibir un pong del cliente
	pingPeriod     = 54 * time.Second // debe ser < pongWait
	maxWSMsgSize   = 4096             // tamaño máximo de un frame entrante
	maxSubsPerConn = 256             // tope de canales suscritos por conexión
)

// Message es la estructura de cada mensaje broadcast via WebSocket
type Message struct {
	Event   string `json:"event"`
	Channel string `json:"channel"`
	Data    any    `json:"data"`
}

// client representa una conexión WebSocket activa
type client struct {
	conn      *websocket.Conn
	send      chan []byte
	userID    uint
	companyID uint
	channels  map[string]bool
	mu        sync.Mutex
}

// Hub gestiona todas las conexiones WebSocket y el broadcast de mensajes
type Hub struct {
	clients    map[*client]bool
	mu         sync.RWMutex
	broadcast  chan *Message
	register   chan *client
	unregister chan *client
	connCount  atomic.Int64
}

var GlobalHub = &Hub{
	clients:    make(map[*client]bool),
	broadcast:  make(chan *Message, 256),
	register:   make(chan *client),
	unregister: make(chan *client),
}

var upgrader = websocket.Upgrader{
	// FIX: Valida el origen contra el frontend URL configurado. En desarrollo
	// se permiten orígenes de localhost; en producción solo el FrontendURL.
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return false
		}
		if config.App.AppEnv == "development" {
			return strings.HasPrefix(origin, "http://localhost") ||
				strings.HasPrefix(origin, "http://127.0.0.1")
		}
		return origin == config.App.FrontendURL
	},
}

// Run es el loop principal del hub — escucha registros, bajas y broadcasts
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			h.mu.Unlock()
			// HIGH-01: connCount ya fue incrementado atómicamente en ServeWS (CAS)

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
				h.connCount.Add(-1)
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			data, _ := json.Marshal(msg)
			h.mu.RLock()
			for c := range h.clients {
				c.mu.Lock()
				subscribed := c.channels[msg.Channel]
				c.mu.Unlock()
				if subscribed {
					select {
					case c.send <- data:
					default:
						// M-17: no se puede enviar a h.unregister aquí porque este
						// select corre dentro de Run(), el único lector de ese canal
						// (deadlock evitado por el default). Cerramos la conexión y
						// readPump hará el unregister real al detectar el cierre.
						c.conn.Close()
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast envía un evento a todos los clientes suscritos al canal indicado
func (h *Hub) Broadcast(channel, event string, data any) {
	h.broadcast <- &Message{Event: event, Channel: channel, Data: data}
}

// Shutdown cierra todas las conexiones WebSocket activas (M-29, graceful shutdown).
// Cada readPump detectará el cierre y hará su unregister.
func (h *Hub) Shutdown() {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		c.conn.Close()
	}
}

// ServeWS hace el upgrade HTTP→WebSocket y registra al cliente en el hub
func ServeWS(c *gin.Context) {
	// HIGH-01: CAS atómico para check+increment — evita race condition en el límite de conexiones
	for {
		cur := GlobalHub.connCount.Load()
		if cur >= maxConnectionsPerHub {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"message": "Servidor al límite de capacidad"})
			return
		}
		if GlobalHub.connCount.CompareAndSwap(cur, cur+1) {
			break
		}
	}

	var userID, companyID uint

	// CRIT-05 / M-03: solo se acepta ticket de un solo uso. Se eliminó el fallback
	// "?token=<jwt>" para no exponer el JWT de sesión en URLs (logs de proxy, Referer).
	ticketStr := c.Query("ticket")
	if ticketStr == "" {
		GlobalHub.connCount.Add(-1)
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	td, ok := consumeWSTicket(ticketStr)
	if !ok {
		GlobalHub.connCount.Add(-1)
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	userID, companyID = td.UserID, td.CompanyID

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		GlobalHub.connCount.Add(-1) // deshacer el CAS increment si el upgrade falla
		log.Printf("ws upgrade error: %v", err)
		return
	}

	cl := &client{
		conn:      conn,
		send:      make(chan []byte, sendBufferSize),
		userID:    userID,
		companyID: companyID,
		channels:  make(map[string]bool),
	}

	GlobalHub.register <- cl

	go cl.writePump()
	go cl.readPump()
}

// A-05: writePump escribe con deadline y envía pings periódicos para detectar
// conexiones muertas (móvil sin señal) y no dejar goroutines colgadas en syscalls.
func (c *client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// El hub cerró el canal: enviamos close frame y salimos.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// readPump maneja los mensajes del cliente: suscripciones a canales.
// A-05: aplica límite de tamaño de frame y deadline de lectura renovado por pongs.
func (c *client) readPump() {
	defer func() { GlobalHub.unregister <- c }()
	c.conn.SetReadLimit(maxWSMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var msg struct {
			Action  string `json:"action"`  // subscribe | unsubscribe
			Channel string `json:"channel"` // ej: "company.5.conversation.42"
		}
		if json.Unmarshal(data, &msg) != nil {
			continue
		}

		// C-01: validar que el canal sea del scope del usuario (cross-tenant prevention)
		if !c.isChannelAllowed(msg.Channel) {
			continue
		}

		c.mu.Lock()
		if msg.Action == "subscribe" {
			// A-05: tope de suscripciones por conexión
			if len(c.channels) < maxSubsPerConn {
				c.channels[msg.Channel] = true
			}
		} else {
			delete(c.channels, msg.Channel)
		}
		c.mu.Unlock()
	}
}

// isChannelAllowed verifica que el cliente tenga permiso para suscribirse al canal.
//
// C-01: TODO canal privado debe estar namespaceado con el prefijo "company.{id}."
// de la empresa del propio cliente. Esto impide que un usuario de la empresa A se
// suscriba a "inbox"/"conversation.N"/"user.N" y reciba datos de otra empresa.
// Formato de canales:
//
//	company.{companyID}.inbox
//	company.{companyID}.conversation.{convID}
//	company.{companyID}.department.{deptID}
//	company.{companyID}.user.{userID}   (además debe coincidir con el propio userID)
func (c *client) isChannelAllowed(channel string) bool {
	prefix := fmt.Sprintf("company.%d.", c.companyID)
	if !strings.HasPrefix(channel, prefix) {
		return false // deniega canales sin namespace o de otra empresa
	}
	sub := strings.TrimPrefix(channel, prefix)

	// Canales de usuario: solo el propio usuario dentro de la empresa
	if strings.HasPrefix(sub, "user.") {
		uid, err := strconv.ParseUint(strings.TrimPrefix(sub, "user."), 10, 64)
		return err == nil && uint(uid) == c.userID
	}

	// Resto de canales permitidos dentro de la empresa (allowlist explícita)
	return sub == "inbox" ||
		strings.HasPrefix(sub, "conversation.") ||
		strings.HasPrefix(sub, "department.")
}
