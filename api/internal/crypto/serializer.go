// Package crypto implementa el cifrado en reposo de campos sensibles de GORM
// (C-06). Registra un serializer "encrypted" que cifra con AES-256-GCM usando una
// clave derivada de config.App.AppKey.
//
// Los campos marcados con `gorm:"serializer:encrypted"` se serializan a JSON, se
// cifran y se almacenan como texto con prefijo "enc:". Al leer se descifran de forma
// transparente. Es compatible hacia atrás: si el valor almacenado NO tiene el prefijo
// "enc:" (dato legacy en claro), se interpreta directamente sin descifrar, de modo que
// las filas existentes siguen funcionando y quedan cifradas al reescribirse.
package crypto

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"

	"harmony-api/internal/config"

	"gorm.io/gorm/schema"
)

const encPrefix = "enc:"

// Register da de alta el serializer "encrypted" en GORM. Debe llamarse al arrancar,
// antes de cualquier operación sobre modelos que lo usen.
func Register() {
	schema.RegisterSerializer("encrypted", EncryptedSerializer{})
}

// EncryptedSerializer cifra/descifra campos AES-256-GCM de forma transparente.
type EncryptedSerializer struct{}

func aesKey() []byte {
	sum := sha256.Sum256([]byte(config.App.AppKey))
	return sum[:]
}

func encrypt(plain []byte) (string, error) {
	block, err := aes.NewCipher(aesKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, plain, nil)
	return encPrefix + base64.StdEncoding.EncodeToString(ct), nil
}

func decrypt(s string) ([]byte, error) {
	if !strings.HasPrefix(s, encPrefix) {
		return nil, fmt.Errorf("valor no cifrado")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, encPrefix))
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(aesKey())
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, fmt.Errorf("ciphertext demasiado corto")
	}
	nonce, ct := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}

// Scan descifra el valor de la base de datos y lo deserializa en el campo.
func (EncryptedSerializer) Scan(ctx context.Context, field *schema.Field, dst reflect.Value, dbValue interface{}) error {
	fieldValue := reflect.New(field.FieldType)
	if dbValue == nil {
		field.ReflectValueOf(ctx, dst).Set(fieldValue.Elem())
		return nil
	}

	var raw string
	switch v := dbValue.(type) {
	case string:
		raw = v
	case []byte:
		raw = string(v)
	default:
		return fmt.Errorf("encrypted: tipo de columna no soportado %T", dbValue)
	}
	if raw == "" {
		field.ReflectValueOf(ctx, dst).Set(fieldValue.Elem())
		return nil
	}

	// Descifrar; si no está cifrado (legacy en claro) usar el valor tal cual.
	plain, err := decrypt(raw)
	if err != nil {
		plain = []byte(raw)
	}

	if len(plain) > 0 {
		if uerr := json.Unmarshal(plain, fieldValue.Interface()); uerr != nil {
			// Legacy en claro que no es JSON (ej. un string sin comillas): asignar directo
			// si el campo es string; de lo contrario propagar el error.
			if field.FieldType.Kind() == reflect.String {
				fieldValue.Elem().SetString(string(plain))
			} else {
				return uerr
			}
		}
	}
	field.ReflectValueOf(ctx, dst).Set(fieldValue.Elem())
	return nil
}

// Value serializa el campo a JSON y lo devuelve cifrado para almacenar.
func (EncryptedSerializer) Value(ctx context.Context, field *schema.Field, dst reflect.Value, fieldValue interface{}) (interface{}, error) {
	plain, err := json.Marshal(fieldValue)
	if err != nil {
		return nil, err
	}
	return encrypt(plain)
}
