package senders

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"harmony-api/internal/models"
)

/*
 * Gestión de plantillas HSM contra la API de Meta.
 *
 * Antes de esto la creación de plantillas era puramente local: se guardaba la fila
 * en message_templates y nunca se llamaba a Meta, así que la plantilla no entraba a
 * revisión, external_template_id quedaba vacío y el envío de plantillas (que usa ese
 * campo como nombre ante Meta) no podía funcionar.
 *
 * Las plantillas se administran a nivel de la cuenta de WhatsApp Business (WABA),
 * no del número: por eso todo acá usa waba_id y no phone_number_id.
 */

// TemplateSpec es la plantilla tal como la define el usuario en Harmony, antes de
// traducirla al formato de "components" que espera Meta.
type TemplateSpec struct {
	Name          string
	Language      string
	Category      string
	Body          string
	HeaderType    string // none | text | image | video | document
	HeaderContent string
	Footer        string
}

// TemplateResult es lo que Meta devuelve al registrar una plantilla.
type TemplateResult struct {
	ExternalID string // id de la plantilla en Meta
	Status     string // normalmente PENDING; a veces APPROVED de una
	Category   string // Meta puede reclasificar la categoría enviada
}

// metaTemplateStatus traduce el estado de Meta (MAYÚSCULAS) al vocabulario interno,
// que es lo que guarda la columna status y entiende la UI.
func metaTemplateStatus(s string) string {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "APPROVED":
		return "approved"
	case "REJECTED":
		return "rejected"
	case "PAUSED":
		return "paused"
	case "DISABLED":
		return "disabled"
	case "PENDING", "IN_APPEAL", "PENDING_DELETION":
		return "pending"
	default:
		return "pending"
	}
}

// MetaTemplateStatus expone la traducción de estados para los handlers/webhook.
func MetaTemplateStatus(s string) string { return metaTemplateStatus(s) }

// wabaCreds obtiene las credenciales necesarias para la API de plantillas.
func wabaCreds(ch *models.Channel) (wabaID, token string, err error) {
	wabaID, _ = ch.Credentials["waba_id"].(string)
	token, _ = ch.Credentials["access_token"].(string)
	if wabaID == "" || token == "" {
		return "", "", fmt.Errorf("el canal de WhatsApp no tiene WABA ID y Access Token configurados")
	}
	return wabaID, token, nil
}

// buildComponents traduce la plantilla de Harmony al arreglo "components" de Meta.
// Meta exige al menos un BODY; HEADER y FOOTER son opcionales.
func buildComponents(spec TemplateSpec) []map[string]any {
	comps := make([]map[string]any, 0, 3)

	switch strings.ToLower(spec.HeaderType) {
	case "text":
		if spec.HeaderContent != "" {
			comps = append(comps, map[string]any{
				"type": "HEADER", "format": "TEXT", "text": spec.HeaderContent,
			})
		}
	case "image", "video", "document":
		// Un encabezado multimedia exige una muestra del archivo (example.header_handle)
		// que se obtiene con la Resumable Upload API. Mientras no se implemente esa
		// subida se omite el encabezado en vez de mandar un component inválido que
		// haría fallar toda la plantilla.
	}

	comps = append(comps, map[string]any{"type": "BODY", "text": spec.Body})

	if spec.Footer != "" {
		comps = append(comps, map[string]any{"type": "FOOTER", "text": spec.Footer})
	}
	return comps
}

// CreateWhatsAppTemplate registra la plantilla en Meta y la deja en revisión.
//
// Meta responde con errores muy concretos (nombre repetido, categoría inválida,
// variables mal numeradas) que se devuelven tal cual para poder mostrárselos al
// usuario: son la diferencia entre "no sé si se envió" y saber exactamente qué
// corregir.
func CreateWhatsAppTemplate(ch *models.Channel, spec TemplateSpec) (TemplateResult, error) {
	wabaID, token, err := wabaCreds(ch)
	if err != nil {
		return TemplateResult{}, err
	}

	// Meta solo acepta nombres en minúscula, con números y guiones bajos.
	name := normalizeTemplateName(spec.Name)
	if name == "" {
		return TemplateResult{}, fmt.Errorf("el nombre de la plantilla no es válido para Meta")
	}
	if spec.Body == "" {
		return TemplateResult{}, fmt.Errorf("la plantilla necesita un cuerpo de mensaje")
	}

	payload := map[string]any{
		"name":       name,
		"language":   normalizeTemplateLanguage(spec.Language),
		"category":   strings.ToUpper(defaultIfEmpty(spec.Category, "UTILITY")),
		"components": buildComponents(spec),
	}

	var out TemplateResult
	cbErr := whatsappBreaker.Call(func() error {
		bodyBytes, _ := json.Marshal(payload)
		apiURL := fmt.Sprintf("https://graph.facebook.com/v21.0/%s/message_templates", wabaID)

		req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("crear plantilla en Meta: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Meta rechazó la plantilla (%d): %s", resp.StatusCode, metaErrorMessage(respBytes))
		}

		var result struct {
			ID       string `json:"id"`
			Status   string `json:"status"`
			Category string `json:"category"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil || result.ID == "" {
			return fmt.Errorf("respuesta inesperada de Meta al crear la plantilla: %s", string(respBytes))
		}
		out = TemplateResult{
			ExternalID: result.ID,
			Status:     metaTemplateStatus(result.Status),
			Category:   result.Category,
		}
		return nil
	})
	if cbErr != nil {
		return TemplateResult{}, cbErr
	}
	return out, nil
}

// FetchWhatsAppTemplateStatus consulta a Meta el estado actual de una plantilla por
// nombre. Sirve como respaldo del webhook message_template_status_update: si ese
// aviso se pierde (app no suscrita al campo, caída del webhook), esto permite
// reconciliar el estado bajo demanda.
// Devuelve también la categoría porque Meta la reclasifica por su cuenta según el
// contenido (una plantilla creada como Utilidad puede terminar en Marketing). Esa
// categoría define el precio y si el mensaje entra en los experimentos de Meta, así
// que conviene reflejar la vigente y no la que se pidió al crearla.
func FetchWhatsAppTemplateStatus(ch *models.Channel, templateName string) (status, reason, category string, err error) {
	wabaID, token, err := wabaCreds(ch)
	if err != nil {
		return "", "", "", err
	}
	name := normalizeTemplateName(templateName)
	if name == "" {
		return "", "", "", fmt.Errorf("nombre de plantilla vacío")
	}

	cbErr := whatsappBreaker.Call(func() error {
		apiURL := fmt.Sprintf(
			"https://graph.facebook.com/v21.0/%s/message_templates?name=%s&fields=name,status,category,rejected_reason&limit=50",
			wabaID, url.QueryEscape(name))

		req, err := http.NewRequest("GET", apiURL, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("consultar plantilla en Meta: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Meta respondió %d: %s", resp.StatusCode, metaErrorMessage(respBytes))
		}

		var result struct {
			Data []struct {
				Name           string `json:"name"`
				Status         string `json:"status"`
				Category       string `json:"category"`
				RejectedReason string `json:"rejected_reason"`
			} `json:"data"`
		}
		if err := json.Unmarshal(respBytes, &result); err != nil {
			return fmt.Errorf("respuesta inesperada de Meta: %s", string(respBytes))
		}
		// El filtro por nombre de Meta es por prefijo: quedarse con la coincidencia exacta.
		for _, t := range result.Data {
			if strings.EqualFold(t.Name, name) {
				status = metaTemplateStatus(t.Status)
				category = t.Category
				if !strings.EqualFold(t.RejectedReason, "NONE") {
					reason = t.RejectedReason
				}
				return nil
			}
		}
		return fmt.Errorf("la plantilla \"%s\" no existe en Meta", name)
	})
	if cbErr != nil {
		return "", "", "", cbErr
	}
	return status, reason, category, nil
}

// DeleteWhatsAppTemplate elimina la plantilla de la cuenta de WhatsApp Business.
//
// Meta borra POR NOMBRE y elimina todos los idiomas de esa plantilla; no existe un
// borrado por id de plantilla que sea equivalente. La operación es irreversible: si
// estaba aprobada, recuperarla implica volver a crearla y esperar revisión de nuevo.
//
// Un 404 de Meta (la plantilla ya no está allá) se trata como éxito: el objetivo
// —que no exista en Meta— ya se cumple, y fallar obligaría al usuario a quedarse
// con una fila local que no puede borrar.
func DeleteWhatsAppTemplate(ch *models.Channel, templateName string) error {
	wabaID, token, err := wabaCreds(ch)
	if err != nil {
		return err
	}
	name := normalizeTemplateName(templateName)
	if name == "" {
		return fmt.Errorf("nombre de plantilla vacío")
	}

	return whatsappBreaker.Call(func() error {
		apiURL := fmt.Sprintf("https://graph.facebook.com/v21.0/%s/message_templates?name=%s",
			wabaID, url.QueryEscape(name))

		req, err := http.NewRequest("DELETE", apiURL, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("eliminar plantilla en Meta: %w", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode == http.StatusNotFound {
			return nil // ya no existe en Meta: objetivo cumplido
		}
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("Meta no pudo eliminar la plantilla (%d): %s", resp.StatusCode, metaErrorMessage(respBytes))
		}
		return nil
	})
}

// metaErrorMessage extrae el mensaje legible del error de Meta. Meta devuelve
// {"error":{"message":..., "error_user_msg":...}}; error_user_msg suele ser el
// texto pensado para mostrarle a una persona.
func metaErrorMessage(body []byte) string {
	var e struct {
		Error struct {
			Message      string `json:"message"`
			ErrorUserMsg string `json:"error_user_msg"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &e) == nil {
		if e.Error.ErrorUserMsg != "" {
			return e.Error.ErrorUserMsg
		}
		if e.Error.Message != "" {
			return e.Error.Message
		}
	}
	return strings.TrimSpace(string(body))
}

// normalizeTemplateName adapta el nombre a lo que exige Meta: solo minúsculas,
// dígitos y guiones bajos, máximo 512 caracteres. "TI Prueba" -> "ti_prueba".
func normalizeTemplateName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '_' || r == ' ' || r == '-':
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	if len(out) > 512 {
		out = out[:512]
	}
	return out
}

// NormalizeTemplateName expone la normalización para los handlers, que deben
// guardar exactamente el mismo nombre con el que la plantilla quedó en Meta.
func NormalizeTemplateName(name string) string { return normalizeTemplateName(name) }

// normalizeTemplateLanguage lleva el idioma al formato de Meta ("es", "es_ES").
func normalizeTemplateLanguage(lang string) string {
	l := strings.TrimSpace(lang)
	if l == "" {
		return "es"
	}
	return strings.ReplaceAll(l, "-", "_")
}

func defaultIfEmpty(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}
