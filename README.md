# DDS238 Energy Meter — PWA v0.1

Μικρή web/PWA εφαρμογή για το DDS238 project που επικοινωνεί με HiveMQ Cloud μέσω MQTT over WebSocket.

## Τι κάνει

- Εμφανίζει `online/offline` από `home/energy/dds238/status`
- Στέλνει `update` στο `home/energy/dds238/request` μόνο όταν πατηθεί **ΑΝΑΝΕΩΣΗ**
- Διαβάζει JSON από `home/energy/dds238/state`
- Εμφανίζει Voltage, Current, Power, PF, Frequency, DEH, Fwd, Rev, Diff και RSSI
- Είναι responsive για κινητό και laptop
- Μπορεί να εγκατασταθεί ως PWA

## HiveMQ WebSocket

Η εφαρμογή είναι προρυθμισμένη με:

- Host: `b7e93fa24c0c4c86a995afecd61e93f3.s1.eu.hivemq.cloud`
- WebSocket port: `8884`
- Path: `/mqtt`

Το username και το password δεν υπάρχουν στον κώδικα. Τα συμπληρώνεις στην εφαρμογή από το γρανάζι.

## GitHub Pages

1. Δημιούργησε νέο repository στο GitHub, π.χ. `dds238-app`.
2. Ανέβασε όλα τα αρχεία αυτού του φακέλου στη ρίζα του repository.
3. Πήγαινε **Settings → Pages**.
4. Στο **Build and deployment**, επίλεξε **Deploy from a branch**.
5. Branch: `main`, folder: `/ (root)`.
6. Μετά από λίγο η εφαρμογή θα είναι διαθέσιμη στο GitHub Pages URL του repository.

## Ασφάλεια credentials

Μην γράψεις το HiveMQ password σε `app.js`, `index.html` ή άλλο αρχείο που θα ανέβει στο GitHub. Η v0.1 ζητά το password στη συσκευή και δεν το αποθηκεύει μόνιμα.

## MQTT.js

Η εφαρμογή φορτώνει MQTT.js 5.15.2 από το unpkg CDN. Για να συνδεθεί στον broker χρειάζεται Internet.
