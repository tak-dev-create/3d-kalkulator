# 3D Print Kalkulator

Web-app (PWA) for å beregne pris på 3D-print og styre lager av produkter, rekvisita, filament og pakker.
Fungerer på Mac, Windows, iPhone og iPad – og kan installeres som app fra nettleseren.

## Funksjoner
- **Kalkyle** – samme beregning som Excel-arket: filament, strøm, printerslitasje, arbeidstid, forbruksartikler, kvalitetstap og påslag.
- **Lager** – produkter, rekvisita, filament (gram) og ferdigpakkede pakker. Alle endringer logges (hvem, når, hvorfor).
- **Pakker** – sett av produkter + rekvisita. Pris = selvkost × påslag. Pakking/salg trekker automatisk fra lager.
- **Strekkoder** – skann EAN/QR med kameraet eller håndskanner, lag egne interne EAN-13-koder, skriv ut A4-etikettark.
- **Bilder** – ta bilde eller last opp; bildene komprimeres og synkes. Eksport til ZIP.
- **Backup** – Excel-backup eller full backup (ZIP med Excel + bilder), gjenoppretting med «slå sammen» eller «erstatt».
- **Flere brukere** – innlogging med Google eller e-post. Administrator gir tilgang per e-postadresse.

## Teknisk
- Ingen byggesteg: rene ES-moduler + [Preact/htm](https://github.com/developit/htm) fra CDN.
- Data: Firebase Firestore (gratisplan «Spark») med offline-støtte. Uten konfigurasjon kjører appen i *lokal modus* (IndexedDB).
- Hosting: GitHub Pages (gratis).
- Bibliotek: SheetJS (Excel), JSZip, JsBarcode, html5-qrcode.

## Oppsett av Firebase
1. Opprett prosjekt på https://console.firebase.google.com (Google Analytics trengs ikke).
2. **Authentication** → Kom i gang → aktiver **Google** og **E-post/passord**.
3. **Authentication → Settings → Authorized domains** → legg til `<brukernavn>.github.io`.
4. **Firestore Database** → Opprett database (produksjonsmodus, region `eur3` eller `europe-west1`).
5. **Firestore → Regler** → lim inn innholdet i `firestore.rules` → Publiser.
6. **Prosjektinnstillinger → Dine apper → Web-app** → registrer og kopier `firebaseConfig` inn i `js/firebase-config.js`.
7. Åpne appen, logg inn, og trykk **«Opprett arbeidsområde (jeg er eier)»**. Du blir administrator.
8. Gi andre tilgang under **Innstillinger → Brukere med tilgang**.

## Publisering (GitHub Pages)
Repoet publiseres fra `main`-grenen (rot). Etter endringer: øk `VERSION` i `sw.js`, commit og push.

## Gratisgrenser (Firebase Spark)
1 GB lagring, 50 000 lesinger og 20 000 skrivinger per dag. Bilder lagres komprimert (~100–300 kB) i Firestore,
så det er plass til flere tusen bilder. Ta jevnlig **full backup** – appen minner deg på det.
