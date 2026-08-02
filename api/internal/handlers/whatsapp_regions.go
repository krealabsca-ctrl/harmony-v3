package handlers

import "strings"

/*
 * Traducción de país ISO a la agrupación de la tarifa de Meta.
 *
 * Meta no cotiza cada país por separado: en su rate card lista unos pocos mercados
 * grandes con nombre propio (Argentina, Brasil, México, India, …) y mete a todos los
 * demás en agrupaciones regionales: "Rest of Latin America" (ROLAM), "North America"
 * (NA), "Rest of Western Europe" (ROWEU), etc.
 *
 * Costa Rica es uno de esos países sin tarifa propia: le corresponde ROLAM. Como
 * nada traducía CR → ROLAM, la búsqueda de precio no encontraba fila y devolvía 0,
 * de modo que TODA campaña a Costa Rica quedaba registrada con costo cero (el país
 * por defecto del asistente de campañas es justamente CR).
 *
 * Este mapa solo necesita cubrir los países SIN tarifa propia. Si un país llegara a
 * tener la suya (porque Meta la agregue y se importe el CSV), la búsqueda encuentra
 * primero la fila exacta y este mapa ni se consulta -- ver lookupWhatsAppPrice.
 */
var countryToMetaRegion = map[string]string{
	// ── Norteamérica ────────────────────────────────────────────────────────
	"US": "NA", "CA": "NA",

	// ── Latinoamérica y Caribe (Meta cotiza aparte AR, BR, CL, CO, MX y PE) ──
	"CR": "ROLAM", // Costa Rica
	"GT": "ROLAM", "SV": "ROLAM", "HN": "ROLAM", "NI": "ROLAM", "PA": "ROLAM",
	"BZ": "ROLAM", "DO": "ROLAM", "CU": "ROLAM", "HT": "ROLAM", "JM": "ROLAM",
	"TT": "ROLAM", "BB": "ROLAM", "BS": "ROLAM", "PR": "ROLAM",
	"EC": "ROLAM", "BO": "ROLAM", "PY": "ROLAM", "UY": "ROLAM", "VE": "ROLAM",
	"GY": "ROLAM", "SR": "ROLAM",

	// ── Europa occidental (Meta cotiza aparte DE, ES, FR, GB, IT y NL) ───────
	"PT": "ROWEU", "BE": "ROWEU", "AT": "ROWEU", "CH": "ROWEU", "IE": "ROWEU",
	"SE": "ROWEU", "NO": "ROWEU", "DK": "ROWEU", "FI": "ROWEU", "IS": "ROWEU",
	"GR": "ROWEU", "LU": "ROWEU", "MT": "ROWEU", "CY": "ROWEU", "AD": "ROWEU",
	"MC": "ROWEU", "SM": "ROWEU", "LI": "ROWEU",

	// ── Europa central y del este (Meta cotiza aparte HU, PL, RO y RU) ───────
	"CZ": "ROCEE", "SK": "ROCEE", "BG": "ROCEE", "HR": "ROCEE", "SI": "ROCEE",
	"RS": "ROCEE", "BA": "ROCEE", "MK": "ROCEE", "AL": "ROCEE", "ME": "ROCEE",
	"UA": "ROCEE", "BY": "ROCEE", "MD": "ROCEE", "EE": "ROCEE", "LV": "ROCEE",
	"LT": "ROCEE", "GE": "ROCEE", "AM": "ROCEE", "AZ": "ROCEE", "KZ": "ROCEE",

	// ── Medio Oriente (Meta cotiza aparte AE, IL, QA y SA) ───────────────────
	"KW": "ROME", "BH": "ROME", "OM": "ROME", "JO": "ROME", "LB": "ROME",
	"IQ": "ROME", "YE": "ROME", "SY": "ROME", "IR": "ROME", "PS": "ROME",

	// ── África (Meta cotiza aparte EG, NG y ZA) ──────────────────────────────
	"KE": "ROA", "GH": "ROA", "TZ": "ROA", "UG": "ROA", "ET": "ROA",
	"MA": "ROA", "DZ": "ROA", "TN": "ROA", "LY": "ROA", "SD": "ROA",
	"SN": "ROA", "CI": "ROA", "CM": "ROA", "ZM": "ROA", "ZW": "ROA",
	"AO": "ROA", "MZ": "ROA", "BW": "ROA", "NA": "ROA", "RW": "ROA",
	"MW": "ROA", "MU": "ROA", "MG": "ROA",
}

// resolveMetaRegion devuelve la agrupación de Meta a la que pertenece el país, o
// cadena vacía si no está mapeado (en ese caso la búsqueda caerá en "OTHER").
//
// OJO con "NA": es a la vez el código ISO de Namibia y el código que Meta usa para
// Norteamérica. En este mapa "NA" está como país africano porque el código de la
// AGRUPACIÓN se resuelve antes por coincidencia exacta con la tabla de tarifas: si
// alguien pasa "NA" existe una fila con ese código y se usa esa, sin llegar acá.
func resolveMetaRegion(countryCode string) string {
	return countryToMetaRegion[strings.ToUpper(strings.TrimSpace(countryCode))]
}
