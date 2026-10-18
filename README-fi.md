# Nodus Observatory 1.0.0

Nexus-palvelimelle tehty paikallinen Nodus storage noden seuranta. Python 3:n
vakiokirjasto riittää; käyttöliittymä ei lataa kirjastoja, fontteja tai kuvia CDN:stä.

## Asennus

Lataa paketti työpöytäkoneelle. Aja sen lataushakemistossa:

```bash
scp nodus-observatory-1.0.0.tar.gz timo@192.168.1.107:~/
ssh timo@192.168.1.107
tar -xzf ~/nodus-observatory-1.0.0.tar.gz -C ~/
cd ~/nodus-observatory-1.0.0
sudo bash backend/install.sh
```

Asennin tarkistaa Noduksen dataosion, asentaa omat tiedostonsa ja käynnistää
vain `nodus-monitor`-palvelut. Se säilyttää aiemman seurannan asetustiedoston
päivityksessä. Nodus- ja PQ-NAS-palveluita ei käynnistetä uudelleen asennuksessa.

Asennuspolut:

- Ohjelma: `/opt/nodus-monitor`
- Asetukset: `/etc/nodus-monitor/config.json`
- Mittaukset, tapahtumat ja palkkiokirjanpito: `/var/lib/nodus-monitor`
- HTTP: `127.0.0.1:8890`

## Avaa sivu

Aja **työpöytäkoneella** ja pidä tämä yhteys auki:

```bash
ssh -N -L 8890:127.0.0.1:8890 timo@192.168.1.107
```

Avaa selaimessa <http://127.0.0.1:8890>. Yhteys on SSH-tunnelissa.
Uutta reitittimen porttiohjausta ei tarvita. Palvelu ei tarjoa internetiin
avointa hallintapaneelia eikä ota vastaan noden hallintakomentoja.

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
tiedostossa `rewards/README.md`. Raportti tuottaa aineistoa omaan kirjanpitoon;
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

Sivun julkaistu esikatselu käyttää käyttäjän aiemmin toimittamia tilannekuvia.
Esikatselun JSON-tiedostoja ei asenneta paikalliseen käyttöliittymään, eikä niiden
avulla korvata epäonnistunutta reaaliaikaista keräystä. Julkaistu esikatselu ei
ole yhteydessä kotiverkon palvelimeen.

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
node --check dist/app.js
bash -n backend/install.sh
```

Lähdesopimus on tarkistettu asennetusta Nodus 0.26.7 / commit
`24f93e6b709119a3013efacf3a374930c97871b7` -versiosta. Ohjelmiston päivitys voi
muuttaa CLI-tekstiä tai tietokantaskeemaa; tuntematon kenttä jätetään tyhjäksi.
