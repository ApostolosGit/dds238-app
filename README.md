# Energy DDS / JSY — PWA v1.1

Κοινή web/PWA εφαρμογή για DDS238 και JSY-MK-333 μέσω HiveMQ Cloud / MQTT over WebSocket.

## Βασική λειτουργία

Η εφαρμογή δεν επιλέγει έναν μόνο μετρητή. Κάνει MQTT wildcard subscribe και εμφανίζει ταυτόχρονα όλους τους online μετρητές που ανακαλύπτει κάτω από:

- `home/energy/+/status`
- `home/energy/+/state`
- `home/energy/+/admin/response`
- `home/energy/+/admin/csv`

Για κάθε online device δημιουργείται ξεχωριστό panel.

## Αυτόματη αναγνώριση DDS / JSY

Η αναγνώριση γίνεται πρώτα από το JSON field `meter` όταν υπάρχει. Αν δεν υπάρχει, γίνεται fallback από τα state fields και από το device id:

- DDS238: `voltage`, `current`, `power`, `pf`, ...
- JSY-MK-333: `v1/v2/v3`, `i1/i2/i3`, `p1/p2/p3`, `pf1/pf2/pf3`, ...

Τα σημερινά firmware topics είναι συμβατά:

- `home/energy/dds238/...`
- `home/energy/jsy333/...`

## Πολλές συσκευές ίδιου τύπου

Το app υποστηρίζει οποιοδήποτε μοναδικό device id στο δεύτερο MQTT path segment. Για πραγματικά πολλές συσκευές ίδιου τύπου, κάθε ESP πρέπει να έχει μοναδικό id, π.χ.:

- `home/energy/dds_main/state`
- `home/energy/jsy_house/state`
- `home/energy/jsy_solar/state`

Αν δύο ESP δημοσιεύουν και τα δύο στο ίδιο `home/energy/jsy333/state`, το app δεν μπορεί να τα ξεχωρίσει γιατί ο broker τα βλέπει ως το ίδιο MQTT device path.

## Εμφάνιση

DDS238:
- Voltage / Current / Power / PF / Frequency
- DEH / Diff / Forward / Reverse / RSSI

JSY-MK-333:
- V1/V2/V3
- I1/I2/I3 με FWD/REV
- P1/P2/P3 με P/E λογική
- Total Power / Total PF / Frequency / Total Energy
- DEH / Diff / RSSI

## Admin ανά συσκευή

Κάθε panel έχει δικές του **ΡΥΘΜΙΣΕΙΣ**:
- STORE DEH
- RESET + STORE
- CLEAR DAILY STATS
- EXPORT DAILY CSV

Οι εντολές στέλνονται μόνο στο MQTT path της συγκεκριμένης συσκευής.

## HiveMQ WebSocket

Default:
- Host: `b7e93fa24c0c4c86a995afecd61e93f3.s1.eu.hivemq.cloud`
- WebSocket port: `8884`
- Path: `/mqtt`

Το username αποθηκεύεται τοπικά. Το password δεν αποθηκεύεται μόνιμα.

## PWA

Η εφαρμογή φορτώνει MQTT.js 5.15.2 από unpkg και μπορεί να εγκατασταθεί ως PWA.


## Διζωνικό Ζ1 / Ζ2

Με firmware 1.16+ (προτεινόμενη τρέχουσα έκδοση: 1.17), κάθε συσκευή μπορεί προαιρετικά να ενεργοποιήσει διζωνική καταμέτρηση από τις **ΡΥΘΜΙΣΕΙΣ** του δικού της panel.

- **Ζ1** = ακριβή / κανονική ζώνη
- **Ζ2** = φθηνή / μειωμένη ζώνη
- Χειμερινή περίοδος (Νοέμβριος–Μάρτιος): Ζ2 02:00–05:00 και 12:00–15:00
- Θερινή περίοδος (Απρίλιος–Οκτώβριος): Ζ2 02:00–04:00 και 11:00–15:00

Όταν το διζωνικό είναι ενεργό, το dashboard εμφανίζει τους μετρητές Ζ1 / Ζ2 και την τρέχουσα ζώνη. Η ρύθμιση και οι αρχικές τιμές Ζ1 / Ζ2 αποστέλλονται στο συγκεκριμένο ESP μέσω του αντίστοιχου MQTT admin topic.

## Firmware 1.17

Η τρέχουσα firmware έκδοση βρίσκεται στο repo `ApostolosGit/ESP8266` ως:

`EnergyMeter_DDS238_JSY_Ver1_17.ino`

Η προεπιλεγμένη τοπική IP είναι `192.168.1.80`. Για επιπλέον ESP στο ίδιο LAN πρέπει να οριστεί διαφορετικό `STATIC_IP_LAST_OCTET`, π.χ. 81, 82, κ.ο.κ.
