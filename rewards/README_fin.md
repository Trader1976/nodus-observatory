# Palkkiotositteet ja kirjanpito

[English](README.md) | [Suomi](README_fin.md)

Verkkopalvelin lukee vain monitorin erillistä `reporting.sqlite3`-tietokantaa.
Root-käyttäjänä ajettava kerääjä avaa olemassa olevan Noduksen ketjutietokannan
SQLite-asetuksilla `mode=ro` ja `query_only=ON`. Käytössä on lukutransaktio,
200 ms:n lukitusodotus ja kahden sekunnin kyselyaikaraja. Kerääjä ei käytä
`immutable=1`-asetusta, kopioi käytössä olevaa tietokantatiedostoa, suorita
WAL-checkpointia eikä muuta ketjutietokantaa. Omistajan haku käyttää Noduksen
omistajaindeksiä, ja yhden keräyksen enimmäismäärä on 5 000 riviä. Ylitys
ilmoitetaan virheenä.

Lähde on valinnainen. Puuttuva lähde tarkoittaa *tuntematonta*, ei keksittyjä
nollapalkkioita. Lähteeksi asetetaan absoluuttinen polku
`/var/lib/nodus/data/witness_<ketjutunnisteen 32 ensimmäistä heksamerkkiä>.db`.
Kerääjä saa koko ketjutunnisteen ja omistajan identiteetin havaitsemastaan
noden tilasta. Tietokannan tiedostonimen on vastattava ketjutunnisteen
alkuosaa. Tämä sitoo paikallisen lähteen nodeen; se ei ole jokaisen maksun
erillinen kryptografinen varmennus.

## Varmennettu lähdesopimus

Toteutus on tarkistettu Noduksen lähdekoodin committia
`24f93e6b709119a3013efacf3a374930c97871b7` vasten:

- [Osoitehistorian rakenne ja merkitykset](https://github.com/nocdem/dna/blob/24f93e6b709119a3013efacf3a374930c97871b7/nodus/src/witness/nodus_witness_addr_index.h)
- [Osoitehistorian toteutus](https://github.com/nocdem/dna/blob/24f93e6b709119a3013efacf3a374930c97871b7/nodus/src/witness/nodus_witness_addr_index.c)
- [Virallisen lohkoselaimen palkkioiden lukija](https://github.com/nocdem/dna/blob/24f93e6b709119a3013efacf3a374930c97871b7/explorer/src/exp_rewards.c)

Taulun `addr_history(h,i,seq,owner,kind,amount,token,fee,peer,wire,ts)`
pääavain on `(h,i,seq)`. Omistaja on 64 tavun raaka sormenjälki, ei
ASCII-heksamerkkijono. Natiivitokenin tunniste on 64 nollatavua.
Rajakohdan palkkiomaksuissa ja stake-palautuksissa `i=4294967295`.
`ts` on vahvistetun lohkon Unix-aika sekunteina, ei keräysaika.
Rajakohdan `kind='payout'` tarkoittaa palkkiota; `kind='release'` tarkoittaa
palautettua stakea ja esitetään erikseen. Muiden kuin rajakohtien EVM release
-rivit eivät kuulu tähän raporttiin.

`addr_history_mark(id=1,from_height,last_height)` kuvaa vain nykyistä
yhtenäistä jaksoa. Sen viimeisen korkeuden on vastattava `v2_blocks`-taulun
nykyistä kärkeä samassa lukutilannekuvassa. Indeksin katkos aloittaa uuden
jakson. Jokainen havaittu jakso säilytetään monitorin kirjanpitotietokannassa,
ja CSV sisältää kaikki sen tunnetut jaksot.

**Indeksi on oletuksena pois käytöstä viitatussa Nodus-versiossa.** Tiedoston
`/etc/nodus.conf` ylimmälle tasolle asetettu `"addr_history_index": true`
ottaa tulevan historian keruun käyttöön, kun witness seuraavan kerran
käynnistyy tällä asetuksella. Vanhaa historiaa ei täydennetä jälkikäteen.
Monitori ei ota indeksiä käyttöön eikä käynnistä Nodusta uudelleen.
Ylläpitäjän on tehtävä tämä erillinen päätös ennen palkkioiden alkamista,
jos hän haluaa paikallisen maksuarkiston siitä eteenpäin.

Odottava palkkiokertymä luetaan keräyshetken taulusta
`v2_reward_accrual(owner_fp BLOB,amount INTEGER)`. Puuttuva omistajarivi
tarkoittaa nollaa vain onnistuneen, kelvollisen kyselyn jälkeen. Odottava
kertymä pidetään erillään toteutuneista maksuista ja valitun vuoden raportista.

Summat käsitellään tarkkoina raakayksikköjen kokonaislukuina ja jaetaan
100 000 000:lla. Pythonin kokonaisluvut ja Decimal-laskenta välttävät
JavaScriptin 2^53-tarkkuusrajan. JSON-summat ovat merkkijonoja.
Tapahtumien yksilöintiin käytetään ketjua, omistajaa, lohkokorkeutta,
alkion sijaintia ja rajakohdan järjestysnumeroa. Jos olemassa olevan
tapahtuman aika, summa tai laji muuttuu, päivitys hylätään. Vanhoja
kirjanpitotositteita ei koskaan korvata hiljaisesti.

Lähde yksilöi *maksun vastaanottavan omistajan*, ei tiettyä storage-nodea.
Mukana voi olla samalle omistajalle maksettuja storage-, validaattori- ja
delegaatiopalkkioita. Noden sormenjälki yksilöi seurattavan asennuksen;
se ei todista, että kaikki omistajan palkkiot kuuluvat tälle storage-nodelle.

## HTTP-rajapinta

- `GET /api/rewards?year=2026`: tarkat vastaanotettujen palkkioiden vuosi- ja
  kuukausiyhteenvedot, erilliset stake-palautukset, nykyinen odottava kertymä,
  havaittu kattavuus ja tapahtumarivit.
- `GET /api/rewards/export.csv?year=2026`: UTF-8 BOM -merkillä alkava,
  pilkuin eroteltu CSV. Se sisältää tarkat raakayksikkö- ja NODUS-summat,
  UTC- ja Europe/Helsinki-ajat, tunnisteet, arvostuksen tositteet, keräysajat,
  lähteen kattavuuden ja testnet/mainnet-merkinnän. Tyhjässä lähteessä on
  `coverage_metadata`-rivi ilman keksittyä rahamäärää.

Kerääjä merkitsee lähteen tällä hetkellä **testnetiksi**. Raportin merkintä
ei osoita, että tokenilla olisi markkina-arvoa.

Vuosi- ja kuukausirajat määräytyvät `Europe/Helsinki`-aikavyöhykkeen mukaan,
historialliset UTC-siirtymät ja kesäaika mukaan lukien. CSV sisältää myös
UTC-ajan. Mikään näkymä ei väitä koko vuotta kattavaksi pelkän noden nykyisen
yhtenäisen indeksijakson perusteella. Tilapäinen lähdevirhe ei poista
aikaisemmin havaittuja tapahtumia.

## Manuaalinen EUR-arvostus tositteineen

Automaattista tokenhintaa tai EUR-arvoa ei ole. Puuttuva noteeraus jää
null-arvoksi, ei arvoksi EUR 0,00. Tämä koskee erityisesti testnet-tokeneita,
joiden markkina-arvoa tai verokohtelua tämä työkalu ei määritä.

Ylläpitäjä voi kirjata dokumentoidun hinnan **jo havaitulle** palkkiomaksulle
tämän rakenteen mukaisella tiedostolla. Korvaa paikkamerkit oikeilla tositteilla:

```json
{
  "schema_version": 1,
  "valuations": [
    {
      "event_id": "<event_id todellisesta raportista>",
      "price_eur": "<dokumentoitu tarkka desimaalihinta per NODUS>",
      "source": "<noteerauksen tai tositteen URL tai dokumenttiviite>",
      "valuation_at": "<ISO 8601 -aikaleima aikavyöhykesiirtymineen>",
      "note": "<miksi valittu tosite soveltuu tähän maksuun>"
    }
  ]
}
```

```bash
sudo python3 /opt/nodus-monitor/rewards.py value \
  --database /var/lib/nodus-monitor/reporting.sqlite3 \
  --file /etc/nodus-monitor/valuations.json
```

`price_eur`-arvon on oltava desimaalimuotoinen **merkkijono**. EUR-summa
lasketaan tarkasti kaavalla raakasumma / 100 000 000 × hinta ilman
binäärisiä liukulukuja tai välivaiheen senttipyöristyksiä. Jokainen korvaus
säilyttää aikaisemman version `reward_valuation_audit`-taulussa. Epäonnistunut
tuontierä hylätään kokonaisuudessaan. Vuoden EUR-yhteissumma sisältää vain
arvostetut maksut, ja raportti näyttää kentät `valued_count`,
`unvalued_count` ja `eur_complete`. Puuttuvia arvoja ei täytetä nollilla.
Yhteenvedot eivät laske verovelkaa, veroprosentteja, tulolajeja,
FIFO-luovutusvoittoja eivätkä vähennyskelpoisia kuluja.

Työkalu säilyttää tositteita ja tuottaa raportteja; se ei anna veroneuvontaa.
Selvitä omaan verotusmaahasi soveltuvat säännöt. Suomessa voit tutustua
[Verohallinnon kryptovaraohjeeseen](https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48411/kryptovarojen-verotus/).
Työkalu ei luokittele storage-palvelusta saatua korvausta passiiviseksi
stakingiksi eikä ratkaise sen oikeudellista tai verotuksellista käsittelyä.

SQLite-kirjanpitotietokanta ja arvostuksen tositteet on sisällytettävä
tavanomaisiin varmuuskopioihin, jos niitä halutaan säilyttää kirjanpitoa
varten. Ne ovat erillään Noduksen identity-hakemistosta. Monitori ei koskaan
lue eikä vie yksityisiä identiteettiavaimia.

## Tarkistukset

```bash
python3 -m unittest discover -s rewards -p 'test_*.py' -v
```

Testit kattavat suuret tarkat summat, kaksoiskirjausten eston,
omistajasuodatuksen, palkkioiden ja palautusten erottelun, puuttuvan
kattavuuden ja sen katkokset, paikalliset vuosi- ja kesäaikarajat,
lähteen lukutilan, rajatun kyselyn epäonnistumisen, tarkat arvostukset,
versiohistorian, virheellisten tuontien hylkäyksen ja CSV-kaavasuojauksen.
Niissä käytetään tilapäisiä keinotekoisia testitietokantoja, joiden tietoja
ei koskaan näytetä oikean noden ansioina.
