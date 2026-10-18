# Valinnainen etäkäyttö puhelimella ja muilla laitteilla

Oletusasennus palvelee osoitteessa `http://127.0.0.1:8890`. Seuranta käynnistyy
systemd:n mukana ja kerää tietoja itsenäisesti. Cloudflare tai oma verkkotunnus
ei kuulu perusasennuksen vaatimuksiin. Jos selain on eri koneella kuin node,
paikalliseen käyttöön tarvitaan SSH-tunneli:

```bash
ssh -N -L 8890:127.0.0.1:8890 USER@NODE_SERVER
```

Korvaa käyttäjä ja palvelimen osoite omillasi. Avaa selaimessa
`http://127.0.0.1:8890/#overview`. Jos työpöytäkoneen portti 8890 on varattu,
käytä esimerkiksi `-L 8891:127.0.0.1:8890` ja selaimessa porttia 8891.

## Cloudflare Tunnel + Access

Ylläpitäjä voi liittää saman paikallisen sovelluksen omaan HTTPS-osoitteeseen.
Puhelimen selaimessa avataan tällöin esimerkiksi `https://nodus.example.com`.
Esimerkkiosoite ei ole tämän projektin tarjoama palvelu: jokainen ylläpitäjä
käyttää omaa verkkotunnustaan, tunneliaan ja kirjautumissääntöjään.

Edellytykset: oma Cloudflaressa hallittu verkkotunnus, Cloudflare Access ja
node-palvelimella palveluna käynnistyvä `cloudflared`. Varaa osoitteelle oma
alidomain. Sama tunneli voi palvella useita sovelluksia eri alidomaineilla.

1. Luo **ensin** Accessiin *Self-hosted application* koko hostnamea varten
   (esimerkiksi `nodus.example.com`, ilman polkurajausta). Lisää Allow-sääntöön
   vain halutut sähköpostiosoitteet ja määritä kirjautumistapa. Älä käytä
   Everyone-, Bypass- tai koko internetin sallivaa sääntöä.
2. Lisää tunneliin uusi *Published application route*. Säilytä muiden
   sovellusten nykyiset reitit.
3. Aseta palveluksi **HTTP**, osoitteeksi **127.0.0.1:8890**. cloudflaredin
   täytyy toimia samalla koneella; erillisen kontin localhost on eri osoite.
4. Aseta *Additional application settings → HTTP settings → HTTP Host Header*
   arvoon **localhost** (`httpHostHeader: localhost`). Sovellus tarkistaa
   Host-otsakkeen; näin nykyinen localhost-rajaus säilyy. Julkisen hostnamen
   lisääminen `allowed_hosts`-listaan ei itsessään ole kirjautumissuojaus.
5. Ota tunnelireitillä käyttöön **Protect with Access**. Valitse oikea Access-
   sovellus / team ja Audience (AUD), jotta cloudflared validoi tämän
   sovelluksen Access-tokenin ennen paikalliseen palveluun välittämistä.
   Tee molemmat Access-asetukset ennen reitin käyttöönottoa.
6. Ohita Cloudflaren välimuisti koko tällä hostnamella. API lähettää jo
   `Cache-Control: no-store`; myös palkkioiden CSV-viennit kuuluvat Accessin
   suojauksen ja välimuistin ohituksen piiriin.
7. Varmista `cloudflared`-palvelun automaattinen käynnistys. Monitori pysyy
   osoitteessa `127.0.0.1:8890`; tämän sivun vuoksi ei avata reitittimen porttia.

## Käyttöönoton tarkistus

- Avaa puhelimella mobiilidatan kautta osoite yksityisessä selainikkunassa.
  Ennen kirjautumista näkyy Accessin kirjautuminen tai kielto, ei dashboard.
- Tarkista myös `/api/dashboard` ja `/api/rewards/export.csv?year=2026` samassa
  kirjautumattomassa istunnossa: mittauksia tai CSV-tiedostoa ei saa näkyä.
- Sallitulla käyttäjällä näkyvät dashboard, API ja CSV-vienti. Tarkista
  mittauksen aika ja odota uutta keräystä; vanha esikatselu ei ole live-dataa.
- Kirjautumattomat muut käyttäjät eivät pääse sisään. Koko hostname kuuluu
  samaan Access-sovellukseen, myös kaikki `/api/`-reitit.
- Poista työpöytäkoneen SSH-tunneli kokeen ajaksi: julkinen HTTPS-osoite toimii
  siitä riippumatta. Palvelimen uudelleenkäynnistyksen jälkeen monitori ja
  cloudflared käynnistyvät palveluina.

Sovellus luottaa tässä mallissa kirjautumisen osalta Cloudflare Accessiin ja
cloudflaredin token-validointiin. Sillä ei ole omaa käyttäjätietokantaa.
Palkkioaineisto ja palvelimen mittaukset kuuluvat vain sallittujen käyttäjien
näkymään. GitHub-repon julkisuus koskee lähdekoodia.

## Ylläpito

Paikallista oletusta tai sovelluskoodia ei tarvitse muuttaa etäkäyttöä varten.
Säilytä tunnelitunnukset, avaimet, Accessin asetukset ja oikeat sähköpostit
palvelimen/Cloudflaren omissa asetuksissa. Niitä ei tallenneta GitHubiin.
Jos etäkäyttö poistetaan, poista vain tämän hostnamen reitti/DNS ja Access-
sovellus hallitusti; muut saman tunnelin sovellukset jatkavat toimintaansa.

Cloudflaren ajantasaiset ensisijaiset ohjeet:

- https://developers.cloudflare.com/tunnel/concepts/routing/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/tunnel/reference/origin-parameters/
