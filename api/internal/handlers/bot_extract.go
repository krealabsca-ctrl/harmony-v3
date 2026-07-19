package handlers

// bot_extract.go — Extracción de texto plano de los documentos de la base de conocimiento
// del bot. TXT/MD/CSV y DOCX se resuelven con la librería estándar (sin dependencias).
// PDF se implementa en extractPDF (ver stub abajo) al agregar la librería correspondiente.

import (
	"archive/zip"
	"fmt"
	"html"
	"io"
	"os"
	"regexp"
	"strings"
)

// maxExtractChars limita el texto extraído por documento para no inflar la memoria ni el
// contexto del bot con archivos enormes.
const maxExtractChars = 200000

var (
	docxTagRe  = regexp.MustCompile(`<[^>]+>`)
	docxParaRe = regexp.MustCompile(`(?i)</w:p>`)
	docxTabRe  = regexp.MustCompile(`(?i)<w:tab[^>]*/>`)
)

// extractText devuelve el texto plano de un documento según su extensión (en minúsculas,
// incluyendo el punto: ".txt", ".docx", etc.).
func extractText(path, ext string) (string, error) {
	switch ext {
	case ".txt", ".md", ".csv":
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return clipText(string(b)), nil
	case ".docx":
		return extractDocx(path)
	case ".pdf":
		return extractPDF(path)
	}
	return "", fmt.Errorf("formato no soportado: %s", ext)
}

// extractDocx lee word/document.xml del .docx (que es un zip) y lo convierte a texto plano:
// cierra de párrafo → salto de línea, tabs → tab, y elimina el resto de las etiquetas XML.
func extractDocx(path string) (string, error) {
	r, err := zip.OpenReader(path)
	if err != nil {
		return "", fmt.Errorf("docx inválido: %w", err)
	}
	defer r.Close()
	for _, f := range r.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		data, err := io.ReadAll(io.LimitReader(rc, 20<<20))
		rc.Close()
		if err != nil {
			return "", err
		}
		s := string(data)
		s = docxTabRe.ReplaceAllString(s, "\t")
		s = docxParaRe.ReplaceAllString(s, "\n")
		s = docxTagRe.ReplaceAllString(s, "")
		s = html.UnescapeString(s)
		return clipText(strings.TrimSpace(s)), nil
	}
	return "", fmt.Errorf("docx sin contenido (word/document.xml)")
}

func clipText(s string) string {
	if len(s) > maxExtractChars {
		return s[:maxExtractChars]
	}
	return s
}

// extractPDF: STUB temporal. Se implementará con la librería github.com/ledongthuc/pdf
// (pure-Go) en cuanto se agregue la dependencia en el servidor. Mientras tanto rechaza el
// PDF con un mensaje claro en vez de guardar un documento vacío.
func extractPDF(path string) (string, error) {
	return "", fmt.Errorf("el soporte de PDF se habilitará en breve; por ahora usa TXT, MD, CSV o DOCX")
}
