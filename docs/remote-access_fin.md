# Valinnainen etäkäyttö puhelimella ja muilla laitteilla

[English](remote-access.md) | [Suomi](remote-access_fin.md)

Oletusasennus palvelee osoitteessa `http://127.0.0.1:8890`. Seuranta käynnistyy
systemd:n mukana ja kerää tietoja itsenäisesti. Cloudflare tai oma verkkotunnus
ei kuulu perusasennuksen vaatimuksiin. Jos selain on eri koneella kuin node,
paikalliseen käyttöön tarvitaan SSH-tunneli:

```bash
ssh -N -L 8890:127.0.0.1:8890 USER@NODE_SERVER
```

Korvaa `USER` SSH-käyttäjätunnuksellasi ja `NODE_SERVER` node-palvelimesi
osoitteella. Avaa selaimessa `http://127.0.0.1:8890/#overview`. Jos
työpöytäkoneen portti 8890 on varattu, käytä esimerkiksi
`-L 8891:127.0.0.1:8890` ja selaimessa porttia 8891.

## Cloudflare Tunnel + Access

Ylläpitäjä voi liittää saman paikallisen sovelluksen omaan suojattuun
HTTPS-osoitteeseen, esimerkiksi `https://node.example.com`, jolloin sitä voi
käyttää myös puhelimella. Esimerkkiosoite ei ole tämän projektin tarjoama
palvelu: jokainen ylläpitäjä käyttää omaa verkkotunnustaan, tunneliaan ja
kirjautumissääntöjään.

Edellytykset: oma Cloudflaressa hallittu verkkotunnus, Cloudflare Access ja
node-palvelimella palveluna käynnistyvä `cloudflared`. Varaa osoitteelle oma
alidomain. Sama tunneli voi palvella useita sovelluksia eri alidomaineilla.

1. Luo **ensin** Accessiin *Self-hosted application* koko hostnamea varten
   (`node.example.com`, ilman polkurajausta). Lisää Allow-sääntöön vain halutut
   sähköpostiosoitteet, esimerkiksi `user@example.com`, ja määritä
   kirjautumistapa. Älä käytä Everyone-, Bypass- tai koko internetin sallivaa
   sääntöä.
2. Lisää tunneliin uusi *Published application route*. Säilytä muiden
   sovellusten nykyiset reitit.
3. Aseta palveluksi **HTTP**, osoitteeksi **127.0.0.1:8890**. Jos lomakkeessa
   on yksi Service URL -kenttä, kirjoita siihen **http://127.0.0.1:8890**.
   `cloudflared`-palvelun on päästävä tähän osoitteeseen node-palvelimella;
   erillisen kontin localhost tarkoittaa kyseistä konttia.
4. Aseta *Additional application settings → HTTP settings → HTTP Host Header*
   arvoon **localhost** (`httpHostHeader: localhost`). Sovellus tarkistaa
   Host-otsakkeen; näin nykyinen localhost-rajaus säilyy. Julkisen hostnamen
   lisääminen `allowed_hosts`-listaan ei itsessään ole kirjautumissuojaus.
5. Ota tunnelireitillä käyttöön **Protect with Access**. Korvaa
   `<your-team-name>` oman Access-tiimisi nimellä ja `<your-application-aud>`
   tämän sovelluksen Audience (AUD) -tunnisteella. Tällöin `cloudflared`
   validoi sovelluksen Access-tokenin ennen paikalliseen palveluun
   välittämistä. AUD ei ole kirjautumissäännön ID eikä tunnelin ID. Määritä
   sekä Access-sääntö että tokenin validointi ennen reitin käyttöönottoa.
6. Lisää node-palvelimen `/etc/nodus-monitor/config.json`-tiedostoon täsmällinen
   julkinen origin ylläpitäjän `settings_allowed_origins`-listaan, esimerkiksi
   `"settings_allowed_origins": ["https://node.example.com"]`. Säilytä muut
   JSON-asetukset ja käytä omaa osoitettasi ilman polkua tai loppukauttaviivaa.
   Käynnistä vain `nodus-monitor.service` uudelleen tämän perusasetuksen
   muutoksen jälkeen. Asetusten tallennus tarvitsee lisäyksen, koska selaimen
   origin on julkinen osoite, mutta tunneli välittää `Host: localhost`-otsakkeen.
   Välitettyihin otsakkeisiin ei luoteta automaattisesti. Lista ei ole
   kirjautumissuojaus eikä muuta kuunteluosoitetta.
7. Ohita Cloudflaren välimuisti koko tällä hostnamella. API lähettää jo
   `Cache-Control: no-store`; myös palkkioiden CSV-viennit kuuluvat Accessin
   suojauksen ja välimuistin ohituksen piiriin.
8. Varmista `cloudflared`-palvelun automaattinen käynnistys. Monitori pysyy
   osoitteessa `127.0.0.1:8890`; tämän sivun vuoksi ei avata reitittimen porttia.

## Käyttöönoton tarkistus

- Avaa puhelimella mobiilidatan kautta osoite yksityisessä selainikkunassa.
  Ennen kirjautumista näkyy Accessin kirjautuminen tai kielto, ei dashboard.
- Tarkista myös `/api/dashboard`, `/api/settings` ja
  `/api/rewards/export.csv?year=2026` samassa kirjautumattomassa istunnossa: mittauksia tai CSV-tiedostoa ei saa näkyä.
- Sallitulla käyttäjällä näkyvät dashboard, API ja CSV-vienti. Tarkista
  mittauksen aika ja odota uutta keräystä varmistaaksesi tietojen päivittymisen.
  Avaa Asetukset ja kokeile Tarkista asetukset -painiketta. Hylätty origin
  tarkoittaa usein puuttuvaa julkista osoitetta `settings_allowed_origins`-listassa.
- Muut käyttäjät eivät pääse sisään. Koko hostname kuuluu samaan
  Access-sovellukseen, myös kaikki `/api/`-reitit.
- Sulje työpöytäkoneen SSH-tunneli kokeen ajaksi: julkinen HTTPS-osoite toimii
  siitä riippumatta. Palvelimen uudelleenkäynnistyksen jälkeen monitorin ja
  `cloudflared`-palvelun tulee käynnistyä palveluina.

Sovellus luottaa tässä mallissa kirjautumisen osalta Cloudflare Accessiin ja
`cloudflared`-palvelun token-validointiin. Sillä ei ole omaa käyttäjätietokantaa.
Kaikki välityspalvelimesta läpi pääsevät voivat muuttaa seurannan muokattavia
asetuksia; sovelluksessa ei ole erillisiä katselu- ja ylläpitäjätunnuksia.
Palkkioaineisto, asetukset ja palvelimen mittaukset kuuluvat vain sallittujen
käyttäjien näkymään. Julkisessa GitHub-repossa on lähdekoodi, ei omia seurantatietojasi.

## Ylläpito

Etäkäyttö säilyttää paikallisen kuunteluosoitteen eikä vaadi sovelluskoodin
muutosta. Host-otsakkeen muuttava välityspalvelin tarvitsee edellä kuvatun
Asetukset-originin.
Säilytä tunnelitunnukset, avaimet, Accessin asetukset ja oikeat sähköpostit
palvelimen tai Cloudflaren omissa asetuksissa GitHub-repon ulkopuolella. Jos
etäkäyttö poistetaan, poista vain tämän hostnamen reitti, DNS-tietue ja
Access-sovellus hallitussa järjestyksessä. Säilytä saman tunnelin muiden
sovellusten asetukset.

Cloudflaren virallisista ohjeista näet ajantasaiset käyttöliittymän nimet ja
asetusten yksityiskohdat:

- [Tunnelien reititys](https://developers.cloudflare.com/tunnel/concepts/routing/)
- [Self-hosted public applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Origin-palvelun asetukset](https://developers.cloudflare.com/tunnel/reference/origin-parameters/)
