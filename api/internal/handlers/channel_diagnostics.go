package handlers

// channel_diagnostics.go — Diagnóstico de canales.
//
// NOTA: el archivo NO puede llamarse channel_test.go: Go trataría ese nombre como
// archivo de pruebas y lo excluiría del binario compilado.
//
// Expone POST /channels/:id/test, que ejecuta una serie de comprobaciones contra
// la plataforma real (Meta o Telegram) y contra el propio webhook de Harmony, y
// devuelve el resultado de cada una para mostrarlo en la pantalla de Canales.
//
// Todas las comprobaciones son de SOLO LECTURA: consultan estado, nunca envían
// mensajes ni modifican la configuración en la plataforma externa.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"harmony-api/internal/config"
	"harmony-api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// graphAPIVersion es la versión de la Graph API usada en las comprobaciones.
const graphAPIVersion = "v23.0"

// Estados posibles de una comprobación.
const (
	checkOK    = "ok"    // funciona correctamente
	checkWarn  = "warn"  // funciona pero conviene revisarlo
	checkError = "error" // impide la operación del canal
)

// channelCheck es el resultado de una comprobación individual.
type channelCheck struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

// diagClient tiene un timeout corto: el diagnóstico se ejecuta desde la interfaz
// y debe responder rápido incluso si la plataforma externa no contesta.
var diagClient = &http.Client{Timeout: 12 * time.Second}

// TestChannel — POST /channels/:id/test
//
// Ejecuta el diagnóstico del canal y devuelve:
//
//	{ overall: "ok"|"warn"|"error", checks: [...] }
//
// overall es el peor estado encontrado entre todas las comprobaciones.
func TestChannel(c *gin.Context) {
	db := c.MustGet("db").(*gorm.DB)

	var ch models.Channel
	if err := db.First(&ch, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"message": "Canal no encontrado"})
		return
	}

	var checks []channelCheck

	// 1. El canal debe estar habilitado para procesar mensajes.
	if ch.IsActive && ch.Status == models.StatusActive {
		checks = append(checks, channelCheck{"active", "Canal habilitado", checkOK,
			"El canal está activo y procesando mensajes."})
	} else {
		checks = append(checks, channelCheck{"active", "Canal habilitado", checkWarn,
			"El canal está desactivado: no recibirá ni enviará mensajes aunque el resto esté bien configurado."})
	}

	switch ch.Type {
	case models.ChannelWhatsApp:
		checks = append(checks, diagnoseWhatsApp(ch)...)
	case models.ChannelMessenger, models.ChannelInstagram:
		checks = append(checks, diagnoseMetaPage(ch)...)
	case models.ChannelTelegram:
		checks = append(checks, diagnoseTelegram(ch)...)
	default:
		checks = append(checks, channelCheck{"type", "Tipo de canal", checkWarn,
			"Este tipo de canal no tiene diagnóstico automático."})
	}

	// El webhook se comprueba igual para todos los tipos.
	checks = append(checks, diagnoseWebhook(ch))

	// overall = peor estado encontrado.
	overall := checkOK
	for _, k := range checks {
		if k.Status == checkError {
			overall = checkError
			break
		}
		if k.Status == checkWarn {
			overall = checkWarn
		}
	}

	c.JSON(http.StatusOK, gin.H{"overall": overall, "checks": checks})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// cred devuelve una credencial del canal como cadena, o "" si no está definida.
func cred(ch models.Channel, key string) string {
	if v, ok := ch.Credentials[key]; ok {
		if s, isStr := v.(string); isStr {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// graphGet hace un GET a la Graph API con el token indicado y devuelve el cuerpo
// decodificado. Si la API responde un error, lo traduce a un mensaje legible.
func graphGet(path, token string, params map[string]string) (map[string]any, error) {
	url := fmt.Sprintf("https://graph.facebook.com/%s/%s", graphAPIVersion, strings.TrimLeft(path, "/"))
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	for k, v := range params {
		q.Set(k, v)
	}
	req.URL.RawQuery = q.Encode()
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := diagClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("no se pudo contactar a Meta: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("respuesta inesperada de Meta (HTTP %d)", resp.StatusCode)
	}
	if errObj, ok := out["error"].(map[string]any); ok {
		msg, _ := errObj["message"].(string)
		if msg == "" {
			msg = fmt.Sprintf("error HTTP %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("%s", msg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Meta respondió HTTP %d", resp.StatusCode)
	}
	return out, nil
}

// str extrae un campo string de un mapa devuelto por la Graph API.
func str(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, isStr := v.(string); isStr {
			return s
		}
	}
	return ""
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

func diagnoseWhatsApp(ch models.Channel) []channelCheck {
	var out []channelCheck

	phoneID := cred(ch, "phone_number_id")
	wabaID := cred(ch, "waba_id")
	token := cred(ch, "access_token")

	// Credenciales presentes
	var missing []string
	if phoneID == "" {
		missing = append(missing, "Phone Number ID")
	}
	if wabaID == "" {
		missing = append(missing, "WABA ID")
	}
	if token == "" {
		missing = append(missing, "Access Token")
	}
	if len(missing) > 0 {
		out = append(out, channelCheck{"credentials", "Credenciales configuradas", checkError,
			"Faltan estas credenciales: " + strings.Join(missing, ", ") + ". Complételas en Canales → Editar."})
		return out // sin credenciales no se puede consultar a Meta
	}
	out = append(out, channelCheck{"credentials", "Credenciales configuradas", checkOK,
		"Phone Number ID, WABA ID y Access Token están registrados."})

	// Token + número: una sola llamada valida ambos
	info, err := graphGet(phoneID, token, map[string]string{
		"fields": "display_phone_number,verified_name,quality_rating,code_verification_status",
	})
	if err != nil {
		detail := err.Error()
		hint := "Verifique que el Access Token sea el permanente de usuario del sistema y que el Phone Number ID corresponda al número."
		if strings.Contains(strings.ToLower(detail), "expired") || strings.Contains(detail, "190") {
			hint = "El token parece expirado: genere uno nuevo de usuario del sistema (los tokens temporales duran 24 horas)."
		}
		out = append(out, channelCheck{"token", "Access Token válido", checkError, detail + " " + hint})
		return out
	}

	out = append(out, channelCheck{"token", "Access Token válido", checkOK,
		"Meta aceptó el token y reconoce el número."})

	numDetail := fmt.Sprintf("Número %s", str(info, "display_phone_number"))
	if vn := str(info, "verified_name"); vn != "" {
		numDetail += fmt.Sprintf(" · nombre visible \"%s\"", vn)
	}
	if cvs := str(info, "code_verification_status"); cvs != "" {
		numDetail += fmt.Sprintf(" · verificación: %s", cvs)
	}
	out = append(out, channelCheck{"phone", "Número de WhatsApp", checkOK, numDetail})

	// Calidad del número
	switch q := strings.ToUpper(str(info, "quality_rating")); q {
	case "GREEN", "HIGH":
		out = append(out, channelCheck{"quality", "Calidad del número", checkOK,
			"Calificación alta. El número opera con normalidad."})
	case "YELLOW", "MEDIUM":
		out = append(out, channelCheck{"quality", "Calidad del número", checkWarn,
			"Calificación media: hubo bloqueos o reportes de clientes. Revise el consentimiento de su base de contactos."})
	case "RED", "LOW":
		out = append(out, channelCheck{"quality", "Calidad del número", checkError,
			"Calificación baja: Meta puede reducir su límite de mensajes o restringir el número. Suspenda las campañas masivas."})
	case "":
		// Meta no siempre expone este campo (p. ej. números de prueba): no es un problema.
	default:
		out = append(out, channelCheck{"quality", "Calidad del número", checkOK, "Calificación: " + q})
	}

	// ¿El App Secret guardado es realmente el de la app de Meta?
	//
	// App Secret y token de verificación (WebhookSecret) son dos campos separados
	// a propósito (ver credAppSecret/signingSecret en stubs.go): el token de
	// verificación solo sirve para el handshake inicial del webhook, y el App
	// Secret es la clave con la que Meta firma cada notificación entrante. Si el
	// App Secret guardado está mal, la firma nunca valida y los mensajes entrantes
	// se descartan en silencio aunque el webhook se vea "conectado".
	//
	// Se comprueba con appsecret_proof: un HMAC-SHA256 del access token usando el
	// App Secret como clave. Si el valor guardado no es el App Secret correcto,
	// Meta rechaza la llamada.
	if appSecret := cred(ch, "app_secret"); appSecret != "" {
		mac := hmac.New(sha256.New, []byte(appSecret))
		mac.Write([]byte(token))
		proof := hex.EncodeToString(mac.Sum(nil))

		if _, proofErr := graphGet(phoneID, token, map[string]string{
			"fields":          "id",
			"appsecret_proof": proof,
		}); proofErr != nil {
			out = append(out, channelCheck{"app_secret", "App Secret configurado correctamente", checkError,
				"El valor guardado como App Secret no es válido según Meta. Cópielo de nuevo desde Configuración de " +
					"la app → Básica → Clave secreta de la aplicación y guárdelo en Canales → Editar → App Secret. " +
					"(Detalle: " + proofErr.Error() + ")"})
		} else {
			out = append(out, channelCheck{"app_secret", "App Secret configurado correctamente", checkOK,
				"El App Secret guardado es válido: las firmas de los mensajes entrantes validarán correctamente."})
		}
	} else {
		out = append(out, channelCheck{"app_secret", "App Secret configurado", checkWarn,
			"No hay App Secret guardado. Harmony usará el token de verificación como respaldo para validar firmas, " +
				"pero eso solo funciona si ambos se registraron con el mismo valor en Meta. Se recomienda configurar " +
				"el App Secret real en Canales → Editar → App Secret."})
	}

	// Suscripción de la app a la WABA: sin esto Meta no entrega los mensajes
	subs, err := graphGet(wabaID+"/subscribed_apps", token, nil)
	if err != nil {
		out = append(out, channelCheck{"subscription", "App suscrita a la cuenta de WhatsApp", checkWarn,
			"No se pudo comprobar la suscripción: " + err.Error() +
				" Puede requerir el permiso whatsapp_business_management en el token."})
	} else if data, ok := subs["data"].([]any); ok && len(data) > 0 {
		out = append(out, channelCheck{"subscription", "App suscrita a la cuenta de WhatsApp", checkOK,
			fmt.Sprintf("La cuenta de WhatsApp tiene %d aplicación(es) suscrita(s) para recibir mensajes.", len(data))})
	} else {
		out = append(out, channelCheck{"subscription", "App suscrita a la cuenta de WhatsApp", checkError,
			"Ninguna aplicación está suscrita a esta cuenta de WhatsApp: Meta no entregará los mensajes. " +
				"En Meta, active la suscripción del campo messages y presione Suscribir en el número."})
	}

	return out
}

// ── Messenger / Instagram ────────────────────────────────────────────────────

func diagnoseMetaPage(ch models.Channel) []channelCheck {
	var out []channelCheck

	pageID := cred(ch, "page_id")
	token := cred(ch, "access_token")

	var missing []string
	if pageID == "" {
		missing = append(missing, "Page ID")
	}
	if token == "" {
		missing = append(missing, "Access Token")
	}
	if len(missing) > 0 {
		out = append(out, channelCheck{"credentials", "Credenciales configuradas", checkError,
			"Faltan estas credenciales: " + strings.Join(missing, ", ") + "."})
		return out
	}
	out = append(out, channelCheck{"credentials", "Credenciales configuradas", checkOK,
		"Page ID y Access Token están registrados."})

	// Una sola llamada valida el token y, para Instagram, comprueba el vínculo con
	// la cuenta profesional (sin ese vínculo los mensajes directos no llegan).
	fields := "id,name"
	if ch.Type == models.ChannelInstagram {
		fields += ",instagram_business_account"
	}
	info, err := graphGet(pageID, token, map[string]string{"fields": fields})
	if err != nil {
		out = append(out, channelCheck{"token", "Access Token de la página", checkError,
			err.Error() + " Verifique que sea un token de página y que no haya sido revocado."})
		return out
	}
	out = append(out, channelCheck{"token", "Access Token de la página", checkOK,
		fmt.Sprintf("Token válido para la página \"%s\".", str(info, "name"))})

	// Instagram: la página de Facebook debe tener vinculada una cuenta profesional.
	if ch.Type == models.ChannelInstagram {
		if iba, ok := info["instagram_business_account"].(map[string]any); ok && str(iba, "id") != "" {
			out = append(out, channelCheck{"instagram_account", "Cuenta de Instagram vinculada", checkOK,
				"La página tiene vinculada una cuenta profesional de Instagram (ID " + str(iba, "id") + ")."})
		} else {
			out = append(out, channelCheck{"instagram_account", "Cuenta de Instagram vinculada", checkError,
				"La página de Facebook no tiene vinculada una cuenta profesional de Instagram, por lo que no llegarán " +
					"mensajes directos. Vincúlela desde la configuración de la página y active los mensajes en Instagram."})
		}
	}

	// Suscripción de la app a la página: sin ella Meta no entrega los mensajes.
	subs, err := graphGet(pageID+"/subscribed_apps", token, nil)
	if err != nil {
		out = append(out, channelCheck{"subscription", "App suscrita a la página", checkWarn,
			"No se pudo comprobar la suscripción: " + err.Error() +
				" Puede requerir el permiso pages_manage_metadata en el token."})
	} else if data, ok := subs["data"].([]any); ok && len(data) > 0 {
		out = append(out, channelCheck{"subscription", "App suscrita a la página", checkOK,
			fmt.Sprintf("La página tiene %d aplicación(es) suscrita(s) para recibir mensajes.", len(data))})
	} else {
		out = append(out, channelCheck{"subscription", "App suscrita a la página", checkError,
			"Ninguna aplicación está suscrita a esta página: Meta no entregará los mensajes. " +
				"En Meta for Developers, en la configuración de Messenger, suscriba la app a la página y active el campo messages."})
	}

	return out
}

// ── Telegram ─────────────────────────────────────────────────────────────────

func diagnoseTelegram(ch models.Channel) []channelCheck {
	var out []channelCheck

	token := cred(ch, "bot_token")
	if token == "" {
		out = append(out, channelCheck{"credentials", "Credenciales configuradas", checkError,
			"Falta el Bot Token. Obténgalo de @BotFather en Telegram."})
		return out
	}
	out = append(out, channelCheck{"credentials", "Credenciales configuradas", checkOK,
		"El Bot Token está registrado."})

	// getMe valida el token
	me, err := telegramGet(token, "getMe")
	if err != nil {
		out = append(out, channelCheck{"token", "Bot Token válido", checkError, err.Error()})
		return out
	}
	name := ""
	if result, ok := me["result"].(map[string]any); ok {
		name = str(result, "username")
	}
	out = append(out, channelCheck{"token", "Bot Token válido", checkOK,
		fmt.Sprintf("Telegram reconoce el bot @%s.", name)})

	// getWebhookInfo dice si el webhook está registrado y si hubo errores de entrega
	info, err := telegramGet(token, "getWebhookInfo")
	if err != nil {
		out = append(out, channelCheck{"telegram_webhook", "Webhook registrado en Telegram", checkWarn, err.Error()})
		return out
	}
	result, _ := info["result"].(map[string]any)
	url := str(result, "url")
	if url == "" {
		out = append(out, channelCheck{"telegram_webhook", "Webhook registrado en Telegram", checkError,
			"El bot no tiene webhook registrado en Telegram: no llegarán mensajes. Guarde el canal de nuevo para registrarlo."})
	} else {
		detail := "Telegram entrega los mensajes en: " + url
		status := checkOK
		if lastErr := str(result, "last_error_message"); lastErr != "" {
			status = checkWarn
			detail += " · Último error reportado por Telegram: " + lastErr
		}
		out = append(out, channelCheck{"telegram_webhook", "Webhook registrado en Telegram", status, detail})
	}

	return out
}

func telegramGet(token, method string) (map[string]any, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/%s", token, method)
	resp, err := diagClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("no se pudo contactar a Telegram: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("respuesta inesperada de Telegram (HTTP %d)", resp.StatusCode)
	}
	if ok, _ := out["ok"].(bool); !ok {
		desc := str(out, "description")
		if desc == "" {
			desc = fmt.Sprintf("error HTTP %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("Telegram rechazó la petición: %s", desc)
	}
	return out, nil
}

// ── Webhook propio ───────────────────────────────────────────────────────────

// diagnoseWebhook comprueba el webhook del canal de la misma forma que lo hace
// Meta: pide el challenge con el token de verificación del canal. Si responde el
// challenge, la dirección es alcanzable y el secreto coincide.
//
// En Telegram no existe ese handshake (su endpoint solo acepta POST y la
// autenticación va en un encabezado), así que allí se limita a comprobar que el
// secreto esté configurado; el registro del webhook se valida aparte con
// getWebhookInfo en diagnoseTelegram.
func diagnoseWebhook(ch models.Channel) channelCheck {
	if ch.WebhookSecret == "" {
		detail := "El canal no tiene token de verificación de webhook. Harmony genera uno automáticamente al crear el " +
			"canal; guárdelo de nuevo en Canales → Editar para que se genere. Sin él, Meta no puede verificar el webhook " +
			"y los mensajes entrantes se descartan."
		if ch.Type == models.ChannelTelegram {
			detail = "El canal no tiene secreto de webhook. En Telegram es la única autenticación de los mensajes entrantes, " +
				"por lo que sin él se rechazan todos. Guarde el canal de nuevo para generarlo."
		}
		return channelCheck{"webhook", "Webhook de Harmony", checkError, detail}
	}

	url := channelWebhookURL(ch)
	if url == "" {
		return channelCheck{"webhook", "Webhook de Harmony", checkWarn,
			"No se pudo construir la dirección del webhook. Revise que FRONTEND_URL esté configurado en el servidor."}
	}

	if ch.Type == models.ChannelTelegram {
		return channelCheck{"webhook", "Webhook de Harmony", checkOK,
			"El secreto está configurado y esta es la dirección que debe estar registrada en Telegram: " + url}
	}

	// Se prueba primero la dirección pública (la que usará la plataforma). Si el
	// servidor no puede alcanzarse a sí mismo por esa ruta, se reintenta contra el
	// API local para distinguir dos situaciones muy distintas:
	//   - el endpoint funciona y el problema es de red/proxy/DNS hacia la URL pública;
	//   - el endpoint mismo está fallando.
	status, body, err := probeWebhook(url, ch.WebhookSecret)
	if err == nil {
		switch {
		case status == http.StatusOK && body != "":
			return channelCheck{"webhook", "Webhook de Harmony", checkOK,
				"La dirección responde el desafío y el secreto coincide. Está lista para registrarse en la plataforma: " + url}
		case status == http.StatusForbidden:
			return channelCheck{"webhook", "Webhook de Harmony", checkError,
				"La dirección respondió 403: el token de verificación no coincidió con el que Harmony tiene guardado " +
					"para este canal. Guarde el canal de nuevo desde Canales → Editar."}
		default:
			return channelCheck{"webhook", "Webhook de Harmony", checkWarn,
				fmt.Sprintf("La dirección %s respondió HTTP %d en lugar del desafío esperado. "+
					"Verifique que el servidor web reenvíe la ruta /api/webhooks al API.", url, status)}
		}
	}

	// La URL pública no fue alcanzable desde el servidor: probar el API local.
	localURL := fmt.Sprintf("http://127.0.0.1:%s/api/webhooks/%s/%s", config.App.Port, ch.Type, ch.PublicID)
	localStatus, localBody, localErr := probeWebhook(localURL, ch.WebhookSecret)
	if localErr == nil && localStatus == http.StatusOK && localBody != "" {
		return channelCheck{"webhook", "Webhook de Harmony", checkWarn,
			"El endpoint del webhook funciona correctamente y el secreto coincide, pero el servidor no pudo " +
				"alcanzar la dirección pública (" + url + "). Compruebe desde fuera que ese dominio sea accesible por " +
				"HTTPS y que reenvíe /api al API; si lo es, el webhook operará sin problema."}
	}
	if localErr == nil && localStatus == http.StatusForbidden {
		return channelCheck{"webhook", "Webhook de Harmony", checkError,
			"El token de verificación no coincidió con el que Harmony tiene guardado para este canal. " +
				"Guarde el canal de nuevo desde Canales → Editar."}
	}
	return channelCheck{"webhook", "Webhook de Harmony", checkWarn,
		"No se pudo comprobar el webhook: " + err.Error() +
			" Verifique que FRONTEND_URL apunte al dominio público y que el servidor web reenvíe /api al API."}
}

// probeWebhook llama al webhook igual que la plataforma al verificarlo y devuelve
// el código HTTP y el cuerpo si coincide con el desafío enviado (cadena vacía si no).
func probeWebhook(url, secret string) (int, string, error) {
	challenge := fmt.Sprintf("harmony-%d", time.Now().UnixNano())
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, "", fmt.Errorf("dirección inválida: %s", url)
	}
	q := req.URL.Query()
	q.Set("hub.mode", "subscribe")
	q.Set("hub.verify_token", secret)
	q.Set("hub.challenge", challenge)
	req.URL.RawQuery = q.Encode()

	resp, err := diagClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if strings.TrimSpace(string(raw)) == challenge {
		return resp.StatusCode, challenge, nil
	}
	return resp.StatusCode, "", nil
}
