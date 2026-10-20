import os
import sys
import time
import psycopg2
import serial
import serial.tools.list_ports

# Intentar cargar variables desde .env si python-dotenv está disponible
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Configuración desde variables de entorno
DATABASE_URL = os.environ.get("DATABASE_URL")
ARDUINO_PORT = os.environ.get("ARDUINO_PORT", "COM9")
BAUD_RATE = int(os.environ.get("BAUD_RATE", 9600))
API_URL = os.environ.get("API_URL")  # Ej: http://localhost:5000/api/esp32/orden

def detectar_puerto_arduino():
    """Busca automáticamente un puerto serie disponible si el configurado falla."""
    puertos = list(serial.tools.list_ports.comports())
    for p in puertos:
        desc = (p.description or "").lower()
        if "arduino" in desc or "ch340" in desc or "cp210" in desc or "ttyacm" in p.device.lower() or "ttyusb" in p.device.lower():
            return p.device
    if puertos:
        return puertos[0].device
    return ARDUINO_PORT

def conectar_serie():
    puerto = ARDUINO_PORT
    print(f"Intentando conectar al Arduino en {puerto} a {BAUD_RATE} baudios...")
    try:
        ser = serial.Serial(puerto, BAUD_RATE, timeout=1)
        time.sleep(2)  # Esperar reinicio automático del Arduino
        print(f"[OK] Conectado exitosamente en {puerto}.")
        return ser
    except Exception as e:
        print(f"[AVISO] No se pudo abrir {puerto}: {e}")
        puerto_auto = detectar_puerto_arduino()
        if puerto_auto and puerto_auto != puerto:
            print(f"Intentando puerto auto-detectado: {puerto_auto}...")
            try:
                ser = serial.Serial(puerto_auto, BAUD_RATE, timeout=1)
                time.sleep(2)
                print(f"[OK] Conectado exitosamente en {puerto_auto}.")
                return ser
            except Exception as e2:
                print(f"[ERROR] Tampoco se pudo conectar a {puerto_auto}: {e2}")
        return None

def consultar_via_api(api_url):
    """Consulta el endpoint del backend /api/esp32/orden si está disponible."""
    import urllib.request
    import json
    try:
        req = urllib.request.Request(api_url, headers={'User-Agent': 'NeutechArduinoBridge/1.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode('utf-8'))
    except Exception as ex:
        print(f"[API ERROR] {ex}")
    return None

def main():
    ser = conectar_serie()
    if not ser:
        print("\n[ERROR] No se pudo establecer conexión serial con el Arduino.")
        print("Verificá que el Arduino esté conectado y configurá la variable ARDUINO_PORT.")
        print("Ejemplo Linux:   export ARDUINO_PORT=/dev/ttyACM0")
        print("Ejemplo Windows: set ARDUINO_PORT=COM9\n")
        return

    if not DATABASE_URL and not API_URL:
        print("[ERROR] DATABASE_URL no configurada. Establecé la variable de entorno o creá un archivo .env.")
        print("Ejemplo: export DATABASE_URL='postgresql://usuario:clave@servidor/neondb?sslmode=require'")
        return

    print("Iniciando bucle de sondeo (cada 3 segundos)...")
    ultimo_payload = None

    while True:
        try:
            # Modo 1: API REST si se especificó API_URL
            if API_URL:
                orden = consultar_via_api(API_URL)
                if orden:
                    nivel = (orden.get("alertLevel") or "normal").lower()
                    estado_alerta = (orden.get("alertStatus") or "resolved").lower()
                    msg = (orden.get("message") or "SISTEMA NORMAL")[:16]
                    lcd_txt = (orden.get("lcdText") or "SISTEMA OK")[:16]
                    buzzer = orden.get("buzzer", False)

                    if nivel == "critical" or buzzer or estado_alerta == "active":
                        payload = f"1|1|ALERTA CRITICA|EVACUAR ZONA|{lcd_txt}|{msg}\n"
                    elif nivel in ("high", "medium"):
                        payload = f"2|0|ALERTA {nivel.upper()[:8]}|{lcd_txt}|{msg}|PRECAUCION\n"
                    else:
                        payload = "0|0|SISTEMA NORMAL|SIN ALERTAS\n"

                    if payload != ultimo_payload:
                        ser.write(payload.encode('utf-8'))
                        print(f"[SERIAL ENVIADO] {payload.strip()}")
                        ultimo_payload = payload
                else:
                    ser.write(b"2|0|API SIN RESPUESTA|REINTENTANDO\n")

            # Modo 2: Base de Datos Neon (PostgreSQL)
            elif DATABASE_URL:
                conn = psycopg2.connect(DATABASE_URL)
                cur = conn.cursor()

                # Consulta corregida para el DER real:
                # - Tabla public."Records" (plural con comillas)
                # - Columna a.related_record_ids como FK hacia r.record_id
                query = """
                    SELECT 
                        a.alert_id, 
                        a.alert_status, 
                        a.message, 
                        r.alert_level, 
                        r.node_id
                    FROM public.alerts a
                    JOIN public."Records" r ON a.related_record_ids = r.record_id
                    WHERE a.alert_status = 'active'
                    ORDER BY 
                        CASE WHEN LOWER(r.alert_level) = 'critical' THEN 1 ELSE 2 END,
                        r.timestamp DESC
                    LIMIT 1;
                """
                cur.execute(query)
                row = cur.fetchone()

                if row:
                    alert_id, alert_status, message, alert_level, node_id = row
                    nivel = (alert_level or "").lower().strip()
                    es_critico = (nivel == "critical")
                    
                    nodo_str = f"NODO: {node_id or 'SISTEMA'}"[:16]
                    msg_str = (message or "Sin descripcion")[:16]

                    if es_critico:
                        # estado = 1 (crítico -> activa buzzer y secuencia de LEDs)
                        # nuevo  = 1 (mantiene vivo el ciclo de 20s de la alarma sonora)
                        l1 = "ALERTA CRITICA"
                        l2 = "EVACUAR ZONA"
                        l3 = msg_str
                        l4 = nodo_str
                        payload = f"1|1|{l1}|{l2}|{l3}|{l4}\n"
                    else:
                        # estado = 2 (informativo -> muestra texto en LCD sin disparar sirena)
                        # nuevo  = 0
                        l1 = f"ALERTA {nivel.upper()}"[:16]
                        l2 = msg_str
                        l3 = nodo_str
                        l4 = f"ID:{alert_id}"[:16]
                        payload = f"2|0|{l1}|{l2}|{l3}|{l4}\n"
                else:
                    # Sin alertas activas: estado=0 apaga buzzer y LEDs
                    payload = "0|0|SISTEMA NORMAL|SIN ALERTAS\n"

                if payload != ultimo_payload:
                    ser.write(payload.encode('utf-8'))
                    print(f"[SERIAL ENVIADO] {payload.strip()}")
                    ultimo_payload = payload

                cur.close()
                conn.close()

        except psycopg2.Error as db_err:
            print(f"[DB ERROR] {db_err}")
            err_payload = "2|0|ERROR CONEXION|BASE DE DATOS\n"
            if ultimo_payload != err_payload:
                try:
                    ser.write(err_payload.encode('utf-8'))
                    ultimo_payload = err_payload
                except:
                    pass
        except Exception as ex:
            print(f"[GENERAL ERROR] {ex}")

        time.sleep(3)

if __name__ == "__main__":
    main()
