# Nodus Observatory

[English](README.md) · **Suomi**

Näyttävä paikallinen seurantasivu Nodus storage nodelle: ketjun synkronointi,
arkistosegmentit, verkon tilanne, palvelimen resurssit, tapahtumat ja erillinen
palkkiokirjanpito vuosikoosteineen ja CSV-vienteineen.

## Nykytila

- Versio **1.0.0**, tuettu Nodus 0.26.7 testnet -asennus Debian/Ubuntu-palvelimella.
- Viisi näkymää: **Yleiskuva, Tallennustila, Verkko, Palkkiot ja Tapahtumat**.
- Yläreunan **FIN / ENG** vaihtaa koko käyttöliittymän suomeksi tai englanniksi.
  Valinta säilyy samassa selaimessa; oletuskieli on suomi.
- Paikallinen kerääjä tallentaa mittauksia noin minuutin välein ja palvelee
  käyttöliittymää oletuksena vain osoitteessa `127.0.0.1:8890`.
- Kuvaajat perustuvat kerättyihin havaintoihin. Puuttuva tieto säilyy puuttuvana;
  vanhentuneet tiedot tai virheet eivät muutu terveeksi tilaksi.
- Palkkiot erotetaan bondien palautuksista. Euromääräinen arvostus ja sen lähde
  voidaan kirjata erikseen; ilman arvostusta euroarvoa ei keksitä.
- `dist/` sisältää myös **synteettisen demon**. Sen keksityt tunnisteet,
  mittaukset ja tapahtumat eivät kuvaa oikeaa palvelinta tai lompakkoa.
  Demotiedostoja ei asenneta paikallisen seurannan mittausdataksi.

Python 3:n vakiokirjasto riittää palvelimella. Käyttöliittymä ei lataa kirjastoja,
fontteja tai kuvia CDN:stä. Kehitystarkistukset käyttävät lisäksi Node.js 22:ta.

Tämä on erillinen monitorointisovellus. Se ei ole Nodus-noden lähdekoodirepo.
Repon mukana ei ole yksityisiä identiteettiavaimia tai lompakon tunnuksia.
Jokainen asennus tunnistaa oman nodensa ja käyttää omia paikallisia asetuksiaan.
Repon esimerkkidata on synteettistä.

## Vaatimukset

- Debian/Ubuntu, systemd ja käynnissä oleva Nodus-node.
- Python 3.10 tai uudempi; palvelimella riittää vakiokirjasto. Ubuntu 24.04 on testattu.
- Git, asennukseen ylläpitäjän oikeudet sekä `nodus-cli`, `findmnt` ja `lsblk`.
- Valinnainen `smartctl` (`smartmontools`) tuetun fyysisen levyn kuntotietoihin.

Käyttöliittymä ei vaadi käännösvaihetta. Node.js 22 tarvitaan vain kehitystesteihin.

## Asennus lähdekoodista

Kloonaa repo node-palvelimelle ja aja sen juuressa:

```bash
git clone https://github.com/Trader1976/nodus-observatory.git
cd nodus-observatory
sudo bash backend/install.sh
```

Uusi asennus tunnistaa julkisen fingerprintin ja datahakemiston paikallisesta
`nodus-cli status` -tulosteesta sekä tiedostojärjestelmän ja tavallisen levyn
`findmnt`/`lsblk`-tiedoista. Myös käyttöjärjestelmän juurilevyllä oleva data on
tuettu. Erillinen dataosio on valinnainen. Verkkoliitäntä seuraa oletusreittiä.
Nodus-palvelun pitää olla käynnissä, jotta tunnistus onnistuu. Yksityisiä avaimia
tai Nodus-asetustiedostoa ei lueta. Tunnistuksen virhe pysäyttää asennuksen ennen
palvelumuutoksia. LVM/RAID-laitteen SMART jää tuntemattomaksi automaattitilassa.

Tarvittaessa kopioi `backend/config.example.json` repon ulkopuolelle, aseta oman
koneesi `data_path`, `mount_path`, `cli_path` ja halutessasi `disk_device` sekä
`rewards_source_db`, ja käytä `sudo bash backend/install.sh --config /polku/config.json`.
`fingerprint: null` käyttää paikallisen noden status-tunnistetta. `mount_path` on
datan todellinen liitoskohta (esimerkiksi `/`, jos erillistä dataosiota ei ole).
Monitorin omat `state_dir`- ja `frontend_dir`-polut ovat asennuksessa kiinteät.
Asenna node-data järjestelmähakemistoon: systemd-palvelun `ProtectHome=yes` rajaa
kotihakemistot pois. SMART tarvitsee `smartctl`-ohjelman (paketti `smartmontools`);
puuttuvat levymittaukset jäävät tuntemattomiksi.

Päivityksessä asennin säilyttää olemassa olevan
`/etc/nodus-monitor/config.json`-tiedoston ja sen konekohtaiset arvot.
`--config` on tarkoitettu vain ensimmäiseen asennukseen.

## Asennetun sovelluksen päivittäminen

Aja puhtaassa lähdekoodihakemistossa node-palvelimella. Korvaa esimerkkipolku
oman kloonisi polulla:

```bash
cd /path/to/nodus-observatory
git switch main
git pull --ff-only origin main
sudo bash backend/install.sh
```

Jos aiempi asennus tuli arkistopaketista, kloonaa repo uuteen hakemistoon ja aja
asennin. Se käyttää olemassa olevia asetuksia ja säilyttää kerätyn historian.
Erillistä julkaisupakettia ei tarvita. Asennin käynnistää vain monitorin omat
palvelut uudelleen; node ja muut palvelinsovellukset jatkavat toimintaansa.

HTTP-palvelin voi tarvita hetken käynnistyäkseen. Tarkista asennuksen jälkeen:

```bash
systemctl is-active nodus-monitor.service nodus-monitor-collect.timer
curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 10 \
  http://127.0.0.1:8890/api/health
```

Päivitä käyttöliittymä selaimessa välimuistin ohittaen (yleensä Ctrl+Shift+R).

Asennuspolut:

- Ohjelma: `/opt/nodus-monitor`
- Asetukset: `/etc/nodus-monitor/config.json`
- Mittaukset, tapahtumat ja palkkiokirjanpito: `/var/lib/nodus-monitor`
- HTTP: `127.0.0.1:8890`

## Avaa sivu

Aja **työpöytäkoneella** ja pidä tämä yhteys auki:

```bash
ssh -N -L 8890:127.0.0.1:8890 USER@NODE_SERVER
```

Avaa selaimessa <http://127.0.0.1:8890>. Yhteys on SSH-tunnelissa.
Uutta reitittimen porttiohjausta ei tarvita. Palvelu ei tarjoa internetiin
avointa hallintapaneelia eikä ota vastaan noden hallintakomentoja.

## Valinnainen etäkäyttö puhelimella

Paikallinen oletusasennus toimii ilman Cloudflarea tai verkkotunnusta.
Ylläpitäjä voi lisätä oman HTTPS-osoitteen Cloudflare Tunnelin ja Accessin kautta.
Katso [etäkäytön määritys ja kirjautumisen tarkistukset](docs/remote-access_fin.md).
Pilvipalvelun tili, domain ja kirjautumissäännöt kuuluvat kyseiseen asennukseen.
Sama käyttöliittymä ja API toimivat sekä localhostissa että suojatulla etäosoitteella.

## Käyttöliittymän kielet

Yläreunan FIN/ENG-painikkeet vaihtavat kaikkien viiden näkymän, kuvaajien,
työkaluvihjeiden, virhetilojen ja tietoa-ikkunan kielen heti. Sivu, kuvaajan
aikaväli, tapahtumasuodatin ja palkkiovuosi säilyvät vaihdossa. Valinta tallennetaan
selaimen paikalliseen tallennustilaan kyseiselle osoitteelle. Jos tallennustila
on estetty, kielivalinta toimii nykyisen sivun ajan. Ensimmäisen käynnin oletus
on suomi; FIN/ENG-painikkeet toimivat myös puhelimella ja näppäimistöllä.

Käännökset eivät muuta mittausdataa tai rahamäärien tarkkuutta. Näytön luvut ja
päiväykset muotoillaan kielivalinnan mukaan; raporttien aikavyöhyke säilyy
Europe/Helsinki-alueena. Alkuperäiset lokiviestit ja tekniset tunnisteet säilyvät
lähteen mukaisina. CSV:n sarakenimet ja täsmälliset rahamäärät pysyvät samoina
molemmilla kielillä, jotta kirjanpidon jatkokäsittely on vakaa.

## Palkkiot: kytke tulevien maksujen historia

Noduksen osoitehistoria on oletuksena pois päältä. Erillinen työkalu näyttää
suunnitelman ja tekee muutoksen vain `--apply`-valitsimella:

```bash
sudo python3 /opt/nodus-monitor/enable-reward-history.py
sudo python3 /opt/nodus-monitor/enable-reward-history.py --apply
sudo nodus-cli status
```

Työkalu varmuuskopioi `/etc/nodus.conf`-tiedoston, lisää
`"addr_history_index": true` ja käynnistää **vain nodus-witness-palvelun kerran**
uudelleen. Ketjudata ja identiteetti säilyvät. Tarkista käynnistyksen jälkeen,
että node palaa synkroniin ja `fail_streak` on kunnossa. Jos asetus on jo päällä,
työkalu ei muuta mitään eikä käynnistä palvelua uudelleen.

Historiassa ei ole takautuvaa täydennystä. Aktivointi kannattaa tehdä ennen
ensimmäisiä palkkiomaksuja. Grace-jakso ja odottava kertymä eivät ole maksettuja
palkkioita. Historialliset puuttuvat tiedot näkyvät puuttuvina.

Palkkiot koskevat **omistajalompakon** vastaanottamia maksuja. Ne voivat sisältää
myös saman omistajan muita rooleja; tämän storage-noden osuutta ei päätellä
kokonaissummasta. Bondien palautukset pidetään erillään palkkioista.

Palkkiot-sivulta ladataan valitun vuoden CSV. Alkuperäiset raw/tokenimäärät,
lohko, tapahtumatunniste, UTC- ja Suomen aika, verkko sekä aineiston kattavuus
säilyvät. Rahamäärät käsitellään täsmällisinä kokonais-/desimaalilukuina.
Puuttuva euromääräinen arvostus näkyy puuttuvana, ei nollana. Nykyinen verkko on
testnet; sovellus ei anna testnet-tokenille markkina-arvoa.

Euromääräisten arvostusten erillinen tuonti, lähteet ja muutoshistoria on kuvattu
tiedostossa [rewards/README_fin.md](rewards/README_fin.md). Raportti tuottaa aineistoa omaan kirjanpitoon;
se ei laske verovelkaa tai luokittele tuloa automaattisesti.

## Mitä kerätään

- Nodus CLI:n tilanne ja julkinen storage-tilakysely ilman identiteetin salaisia avaimia.
- Oma ja verkon lohkokorkeus, lohkoero, grace, fail_streak, segmentit ja palvelut.
- Palvelimen CPU, muisti, levytila, verkko- ja levyliikenne; SMART noin 15 min välein.
- Enintään 300 luokiteltua journal-havaintoa keräyskerralla. Tämä ei ole täydellinen lokiarkisto.
- Verkon julkiset Scan-tilastot noin 5 min välein ja paikallinen komiteakysely.
- Valinnaiset todelliset palkkiomaksut paikallisesta Nodus-tietokannasta vain lukemalla.

Mittauksia kerätään noin minuutin välein. Pitkä tai aikakatkaistu kysely voi
siirtää seuraavaa keräystä; tuoreus näkyy sivulla. Ensimmäisellä keräyksellä ei
vielä ole kahden näytteen erotusta CPU-/siirtonopeuksille. Mittaushistoriaa
säilytetään oletuksena 30 päivää. Palkkiokirjanpitoa ei poisteta tämän rajan mukana.

Staattinen demo käyttää synteettisiä JSON-esimerkkejä. Niitä ei asenneta paikalliseen
käyttöliittymään eikä käytetä epäonnistuneen reaaliaikaisen keräyksen korvikkeena.
Demotila on merkitty näkyvästi. Oikeat mittaukset tulevat asennetusta kerääjästä.
Kerääjä tarkistaa myös valinnaisten PQ-NAS- ja cloudflared-palveluiden tilan,
jos ne on asennettu. Niitä ei vaadita monitorin käyttöön.

## Tarkistukset ja lokit

```bash
systemctl status nodus-monitor nodus-monitor-collect.timer --no-pager
sudo journalctl -u nodus-monitor-collect -n 30 --no-pager
curl -fsS http://127.0.0.1:8890/api/health
```

Kerääjän tilatiedostoissa virhe on virhe, ei nolla tai terve tila. Puuttuvat
ulkopuoliset verkkotilastot eivät estä oman noden seurantaa.

Varmuuskopioi `/var/lib/nodus-monitor` ja mahdolliset arvostusten lähdeasiakirjat
säännöllisesti. Erillisen SQLite-kirjanpidon johdonmukaisen varmuuskopion voi tehdä:

```bash
sudo python3 - <<'PY'
import sqlite3
from pathlib import Path
from datetime import datetime, timezone
src = Path('/var/lib/nodus-monitor/reporting.sqlite3')
dst = Path('/root/nodus-rewards-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.sqlite3')
if not src.is_file():
    raise SystemExit('Palkkiokirjanpitoa ei vielä ole.')
with sqlite3.connect(src.as_uri() + '?mode=ro', uri=True) as source:
    with sqlite3.connect(dst) as target:
        source.backup(target)
dst.chmod(0o600)
print(dst)
PY
```

## Poistaminen

```bash
sudo systemctl disable --now nodus-monitor.service nodus-monitor-collect.timer
sudo systemctl stop nodus-monitor-collect.service
```

Tämä pysäyttää vain seurannan. Säilytä kirjanpitotietokanta ja asetukset.
Paketin poisto ei poista Nodus-dataa, muuta storage-rekisteröintiä tai vapauta bondia.

## Kehityksen tarkistukset

```bash
python3 -m unittest discover -s backend/tests -v
python3 -m unittest discover -s rewards -p 'test_*.py' -v
python3 -m unittest discover -s tests -v
node --check dist/i18n.js
node --check dist/app-translations.js
node --check dist/app.js
node tests/frontend-smoke.mjs dist
node tests/frontend-i18n.mjs dist
bash -n backend/install.sh
```

Lähdesopimus on tarkistettu asennetusta Nodus 0.26.7 / commit
`24f93e6b709119a3013efacf3a374930c97871b7` -versiosta. Ohjelmiston päivitys voi
muuttaa CLI-tekstiä tai tietokantaskeemaa; tuntematon kenttä jätetään tyhjäksi.


GitHub Actions suorittaa samat Python-testit, käyttöliittymän smoke- ja kielitestit sekä
syntaksitarkistukset. Testit eivät tarvitse Nodus-nodea, juurioikeuksia tai
ulkopuolisia verkkopalveluita; API-testit käyttävät paikallista testipalvelinta.

## Repon rakenne

| Hakemisto | Sisältö |
|---|---|
| `backend/` | Kerääjä, paikallinen HTTP-API, asetusesimerkki ja systemd-asennus |
| `dist/` | Valmis käyttöliittymä ja synteettiset demotiedostot |
| `docs/` | Käyttöönotto-ohjeet englanniksi ja suomeksi |
| `rewards/` | Palkkiot, arvostukset, CSV-vienti ja aineiston kattavuus |
| `tests/` | Verkkoadapterin, julkisten esimerkkien ja käyttöliittymän testit |
| `.github/workflows/` | Automaattiset tarkistukset |

Älä lisää repon tiedostoihin palvelimen mittaustietokantoja, lokiarkistoja,
veroraportteja, `.env`-tiedostoja tai identiteettiavaimia. Niiden oletuspolut ja
yleiset tiedostomuodot on rajattu pois `.gitignore`-tiedostossa. Palkkiokirjanpidon
varmuuskopiot säilytetään erillään lähdekoodista.

Dokumentaatiota ylläpidetään pareittain: päivitä englanninkielinen sivu ja sen
`_fin.md`-vastine samalla muutoksella. Vanha `README-fi.md` säilyy ohjaavana linkkinä.
Käytä esimerkeissä dokumentaatioon varattuja osoitteita, paikkamerkkejä ja keksittyjä
tunnisteita. Frontend-testit eivät käytä oikeaa selainta; tarkista ulkoasumuutokset
myös selaimessa, kun kehität käyttöliittymää.
