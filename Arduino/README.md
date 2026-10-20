# Módulo de Alarma Física (Arduino Uno + Script Python)

Este módulo controla la etapa física de alerta mediante un Arduino Uno conectado por USB y un script en Python que sondea la base de datos de Neon o el backend API.

## Componentes y Pinout en Arduino Uno

| Componente | Pin Arduino | Descripción |
|---|---|---|
| **LED Amarillo** | Pin 7 | Indicador visual de alerta |
| **LED Rojo** | Pin 6 | Indicador visual de alerta crítica |
| **LED Verde** | Pin 5 | Indicador visual de alerta |
| **LED Azul** | Pin 4 | Indicador visual de alerta |
| **Buzzer Izquierdo** | Pin 11 | Zumbador continuo de fondo durante alarma |
| **Buzzer Central** | Pin 12 | Zumbador estroboscópico |
| **Buzzer Derecho** | Pin 13 | Zumbador estroboscópico |
| **Buzzer Extra 1** | Pin 10 | Secuencia sonora |
| **Buzzer Extra 2** | Pin 9 | Secuencia sonora |
| **LCD 16x2 I2C** | SDA (A4) / SCL (A5) | Dirección I2C: `0x27` |

> **Nota eléctrica:** Utilizar resistencias limitadoras para los LEDs (220-330Ω) y transistores o módulo relé para los buzzers a fin de no sobrecargar el límite de corriente del microcontrolador ATmega328P.

---

## Protocolo Serial

La comunicación opera a **9600 baudios** con formato posicional delimitado por plecas (`|`):

```text
estado|nuevo|linea1|linea2|linea3|linea4\n
```

* **`estado`**:
  * `1` = Alerta crítica (activa secuencia de LEDs y buzzers sonoros).
  * `2` = Alerta media / advertencia (actualiza pantalla LCD sin disparar sirena sonora).
  * `0` = Sistema normal / sin alertas (apaga sirena y resetea pantalla).
* **`nuevo`**:
  * `1` = Activa o renueva el ciclo crítico de 20 segundos de duración.
  * `0` = No renueva el ciclo.
* **`linea1` a `linea4`**: Textos de hasta 16 caracteres organizados en pares de líneas para la pantalla LCD 16×2.

*(El firmware incluye además compatibilidad automática con paquetes etiquetados `ID:...|LVL:...` y `STATUS:...`).*

---

## Ejecución del Script Python

1. Instalar dependencias:
   ```bash
   pip install -r requirements.txt
   ```

2. Configurar variables de entorno (o crear un archivo `.env`):
   ```bash
   export DATABASE_URL="postgresql://usuario:clave@servidor/neondb?sslmode=require"
   export ARDUINO_PORT="/dev/ttyACM0"  # En Windows: COM9
   ```

3. Opcionalmente, se puede utilizar el modo API REST indicando `API_URL`:
   ```bash
   export API_URL="http://localhost:5000/api/esp32/orden"
   ```

4. Ejecutar el script:
   ```bash
   python scriptArduino.py
   ```
