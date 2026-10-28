# EL Fantasy Pomoćnik

Aplikacija za EuroLeague Fantasy Challenge: forma igrača, kako ekipe brane po pozicijama i tipovima igrača, raspored narednih kola i preporuke do 4 izmene (uključujući trenera) u okviru tvojih kredita.

Radi kao **PWA** (web aplikacija koja se instalira): isti kod radi na Windows-u i na iPhone-u, sa ikonicom, preko celog ekrana i bez interneta za već učitane podatke.

## Šta radi

| Ekran | Šta prikazuje |
|---|---|
| **Moj tim** | Unosiš 4 beka, 4 krila, 2 centra, trenera, njihove cene i preostale kredite. Dugme *Preporuči izmene* traži najbolju kombinaciju do 4 izmene za naredna kola; pored najbolje daje alternative i varijante sa manje izmena. Analiza tima predlaže kapitena i prvu petorku. |
| **Forma** | Svi igrači: prosek PIR-a, poslednje 3 utakmice, forma (▲/▼), izostanci, projekcija za naredna kola i protivnici obojeni po težini. Klik na igrača otvara detalje i log utakmica. |
| **Odbrane** | Za svaku ekipu: koliko PIR-a protivnički igrači ostvaruju u odnosu na svoj prosek, po poziciji (bek/krilo/centar) i po tipu igrača (organizator, šuter, prodorni, unutrašnji, svestrani). Takođe primljeni poeni po poziciji i najlakši rasporedi po poziciji. |
| **Ekipe** | Tabela, forma poslednjih 5, naredna kola obojena po očekivanom ishodu; klik na ekipu daje roster i raspored. |
| **Podešavanja** | Osvežavanje podataka, masovni unos cena, prenos tima između uređaja, tema. |

### Kako se računa projekcija

- **Igrač:** 60% sezonski prosek PIR-a + 40% poslednje 3 utakmice, pa korekcija za protivnika (koliko taj protivnik dozvoljava poziciji i tipu igrača), ±0,6 za domaći teren/gostovanje i +10% bonus pomnožen šansom za pobedu. Ako igrač nije igrao poslednju utakmicu svog kluba, projekcija se smanjuje (moguća povreda).
- **Trener:** očekivani bodovi po pravilima (+10/+20/+25 za pobedu, −5/−10/−20 za poraz) iz očekivane razlike na utakmici, koja se računa iz gol-razlike ekipa i domaćeg terena.
- **Kola unapred:** bliža kola imaju veću težinu (1, 0.8, 0.65…).
- **Klizač „poeni ↔ rast kredita”:** daje prednost igračima čija je projekcija visoka u odnosu na cenu, jer takvi poskupljuju.

### Cene (krediti)

Cene i promena cene posle kola preuzimaju se automatski iz zvanične EuroLeague Fantasy Challenge igre, preko javnog skupa podataka [gaizkafrutos/euroleague-fantasy-analytics](https://github.com/gaizkafrutos/euroleague-fantasy-analytics) (MIT licenca). Taj projekat snima tržište igre na svaka 2 sata, a njegova tabela `crosswalk.csv` povezuje Fantasy ID igrača sa zvaničnim EuroLeague kodom.

Ako taj izvor prestane da radi, aplikacija ostaje upotrebljiva: igrači bez zvanične cene dobijaju **procenu** (sivo polje), a pravu cenu možeš upisati ručno — u *Moj tim*, u detaljima igrača ili masovno u *Podešavanjima* (`Prezime;cena`, jedan red po igraču).

## Pokretanje na Windows-u (lokalno)

Potreban je [Node.js](https://nodejs.org) (18 ili noviji).

Dvoklik na `start.cmd` — preuzme najnovije podatke, pokrene aplikaciju i otvori je u browseru na `http://localhost:8787`.

U Edge-u ili Chrome-u: meni **⋯ → Apps → Install this site as an app** (Edge) ili ikonica za instalaciju u adresnoj traci (Chrome). Aplikacija dobija svoju ikonicu u Start meniju. Lokalna verzija radi dok je `start.cmd` pokrenut.

## Objavljivanje na internetu (potrebno za iPhone)

iPhone može da instalira PWA samo sa HTTPS adrese, zato se aplikacija objavljuje besplatno na **GitHub Pages** ili **GitLab Pages** (varijanta ispod). Podaci se tamo sami osvežavaju na svaka 3 sata (`.github/workflows/update.yml`), pa računar ne mora biti uključen.

1. Napravi nalog na [github.com](https://github.com) i novi **javni** repozitorijum, npr. `euroleague-fantasy`.
2. U folderu projekta:
   ```bash
   git init -b main
   git add .
   git commit -m "EL Fantasy Pomoćnik"
   git remote add origin https://github.com/<tvoj-nalog>/euroleague-fantasy.git
   git push -u origin main
   ```
3. Na GitHub-u: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Osvezi podatke i objavi → Run workflow** (ili sačekaj prvi automatski prolaz posle push-a).
5. Aplikacija je na `https://<tvoj-nalog>.github.io/euroleague-fantasy/`.

### Varijanta: GitLab Pages

Isto radi i na GitLab-u (`.gitlab-ci.yml`). Projekat može biti i privatan, samo Pages stranica mora biti dostupna.

1. Na [gitlab.com](https://gitlab.com) napravi novi prazan projekat, npr. `euroleague-fantasy`.
2. U folderu projekta:
   ```bash
   git init -b main
   git add .
   git commit -m "EL Fantasy Pomoćnik"
   git remote add origin https://gitlab.com/<tvoj-nalog>/euroleague-fantasy.git
   git push -u origin main
   ```
3. Push pokreće pipeline koji preuzme podatke i objavi aplikaciju (**Build → Pipelines**).
4. Adresa je u **Deploy → Pages**. Ako je projekat privatan, u **Settings → General → Visibility** podesi **Pages: Everyone**, da bi stranica radila na telefonu bez prijave na GitLab.
5. Automatsko osvežavanje: **Build → Pipeline schedules → New schedule**, interval `15 */3 * * *`, grana `main`.

Kao i GitHub varijanta, pipeline ne upisuje podatke nazad u repozitorijum — svaki prolaz ih preuzme iznova, a već odigrane utakmice čuva u CI kešu.

### Instalacija na iPhone

1. Otvori gornju adresu u **Safari-ju**.
2. Dugme **Share** (kvadrat sa strelicom) → **Add to Home Screen** → **Add**.
3. Ikonica „EL Fantasy” se pojavljuje na početnom ekranu i otvara aplikaciju preko celog ekrana.

Tim i cene se čuvaju na svakom uređaju posebno. Za prenos: *Podešavanja → Kopiraj moj kod* na jednom uređaju, pa *Učitaj kod* na drugom.

## Struktura

| Fajl | Uloga |
|---|---|
| `scripts/fetch-data.mjs` | Preuzima raspored, box score-ove i rostere sa `api-live.euroleague.net` → `data/data.json` (box score-ovi se keširaju u `cache/games`) |
| `model.js` | Analitika: forma, tipovi igrača, odbrana po poziciji/tipu, projekcije, optimizacija izmena |
| `app.js`, `index.html`, `styles.css` | Interfejs |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (instalacija, offline) |
| `scripts/serve.mjs`, `start.cmd` | Lokalni server za Windows |
| `scripts/make-icons.mjs` | Generiše ikonice |

Sezona se bira automatski (od jula nova sezona); ručno: `node scripts/fetch-data.mjs E2026`.
