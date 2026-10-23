# Noden roolit ja Observatoryn asetukset

[English](settings.md) · **Suomi**

Yläreunan pääalueet ovat **Observatory**, **Sopimusstudio** ja **Asetukset**.
Observatory seuraa storage-nodea, witness-nodea tai molempia. Sopimusstudion
nykyiset editorit ja asiakirjatyökalut säilyvät omana kokeellisena alueenaan;
muutos ei lisää sopimusten julkaisutoimintoa ketjuun.

## Valitse roolit ja näkymä

Ota **Asetuksissa** käyttöön roolit, joita tämän asennuksen pitää seurata.
Vähintään **Storage** tai **Witness** pitää olla valittuna. Valinnat kuvaavat
olemassa olevaa Nodus-asennusta. Ne eivät rekisteröi node-roolia, käynnistä tai
pysäytä Nodus-palvelua, muuta `/etc/nodus.conf`-tiedostoa tai vapauta bondia.

Observatoryn näkymävalinta muuttaa vain esitettävää sisältöä:

| Näkymä | Sisältö |
| --- | --- |
| Yleiskuva | Yhteiset ketju-, verkko- ja palvelinhavainnot sekä valitut roolit |
| Tallennustila | Storage-roolin tila, segmentit ja tallennuksen havainnot |
| Witness | Witness-palvelun tila ja paikallisen komiteakyselyn havainnot |

Tallennustila- ja Witness-näkymät näytetään vain seurantaan valituille rooleille.
Linkki käytöstä poistettuun rooliin avaa Yleiskuvan. Verkko, Palkkiot ja
Tapahtumat ovat yhteisiä seurantasivuja. Näkymän vaihtaminen ei muuta keruuta,
valittuja rooleja tai hälytyksiä. Myös pelkällä witness-nodella seurataan levyn
ja palvelimen resursseja; käyttämätön storage-rooli ei ole vika.

Seurantaan valittu rooli säilyy valittuna, vaikka sen palvelu kaatuu. Virhe
näytetään eikä roolia poisteta huomaamatta seurannasta. Puuttuva havainto on
tuntematon, ei onnistunut tarkistus tai nollamittaus. Komiteajäsenyys kertoo
havaitusta komiteasta; se ei todista tulevaa osallistumista tai tiettyä palkkiota.

Uusi asennus käyttää roolien tunnistukseen paikallisia palvelutietoja. Tarkista
tulos Asetuksissa. Jos aiemman asennuksen perusasetuksista puuttuu `roles`,
molempien roolien seuranta säilyy käytössä aiemman toiminnan säilyttämiseksi.
Automaattitunnistus ei poista jatkuvasti palveluita, jotka lakkaavat vastaamasta.

## Muokkaa asetuksia

| Asetus | Toiminta |
| --- | --- |
| Noden näyttönimi | Valinnainen, enintään 80 merkkiä; tyhjä käyttää havaittua palvelinnimeä |
| Seurattavat roolit | Storage, Witness tai molemmat |
| Oletusnäkymä | Yleiskuva, Tallennustila tai Witness; käytöstä poistettu rooli avaa Yleiskuvan |
| Mittaushistoria | 1–366 päivää; erillinen palkkiokirjanpito säilytetään itsenäisesti |
| Verkkoliitäntä | Liitännän tunniste; tyhjä käyttää automaattista tunnistusta |
| Levylaite | Laitteen tunniste, esimerkiksi `sda`; tyhjä poistaa laitekohtaiset I/O- ja SMART-kyselyt |
| Ulkoiset verkkokyselyt | Ohjaa ulkoisia verkkokyselyitä, myös Scanin palkkiotuontia |
| Palkkioiden keruu | Ohjaa paikallista keruuta ja Scan-tuontia |
| Scan-palkkiotuonti | Ohjaa Scan-lähdettä; paikallinen keruu voi jatkua erikseen |

**Tarkista asetukset** tarkistaa ehdotettujen asetusten kelvollisuuden, CLI:n
suoritettavuuden ja viimeksi havaitut palvelujen tilat. Verkkopalvelu ei tutki
Nodus-datan polkuja rajauksensa läpi. Tiedostojärjestelmän tarkistukset ovat
kerääjän tehtävä ja näkyvät tässä tuntemattomina. Painike ei suorita
Nodus-komentoja eikä tallenna mitään.

**Tallenna asetukset** tarkistaa ja tallentaa seuranta-asetukset atomisesti.
Näyttönimet ja navigointi päivittyvät heti. Kerääjä käyttää tallennettuja arvoja
seuraavassa ajastetussa mittauksessa, tavallisesti noin minuutin kuluessa.
Nodusta tai monitoria ei tarvitse käynnistää uudelleen. Lyhennetty
säilytysaika vaikuttaa historian normaaliin siivoukseen, joten harkitse arvo
ennen tallennusta.

Tallentamaton luonnos säilyy navigoinnissa ja kielenvaihdossa nykyisen sivun
käyttökerran ajan. Sivun uudelleenlataus tai sulkeminen voi poistaa luonnoksen.
FIN/ENG-kielivalinta tallennetaan erikseen kyseisen selaimen tallennustilaan.
Tallennetut seuranta-asetukset koskevat tämän asennuksen kaikkia käyttäjiä,
eivät vain nykyistä selainta. Staattinen demo ei voi tallentaa oikeita asetuksia.

Jos toisessa selaimessa on tallennettu asetukset niiden lataamisen jälkeen,
tallennus ilmoittaa ristiriidasta eikä korvaa uudempia arvoja. Lataa asetukset
uudelleen, tarkista nykyiset arvot ja tee muutoksesi uudelleen.

## Ylläpitäjän asetukset ja tiedostot

| Tiedosto | Tarkoitus |
| --- | --- |
| `/etc/nodus-monitor/config.json` | Ylläpitäjän omistamat perusasetukset |
| `/var/lib/nodus-monitor/settings/settings.json` | Asetukset-sivun tallentamat rajatut asetukset |
| `/var/lib/nodus-monitor` | Mittaukset, tapahtumat ja erillinen palkkiokirjanpito |

Tallennetut sivuasetukset ohittavat vastaavat perusasetukset. Jos arvo on jo
tallennettu käyttöliittymästä, muuta sitä Asetuksissa. Pelkkä perusarvon
muokkaus ei ohita tallennettua sivuasetusta. Asennuksen päivitys säilyttää
molemmat asetustiedostot ja kerätyn historian.

Lisäasetuksissa CLI:n, Nodus-datan, liitoskohdan ja palkkiolähdetietokannan polut
ovat vain luettavia. Ylläpitäjä muuttaa polut erikseen
`/etc/nodus-monitor/config.json`-tiedostossa. Käytä järjestelmähakemistoja, joihin
asennetut palvelut pääsevät; `ProtectHome=yes` rajaa kotihakemistot pois.
Verkkosivu ei voi valita juurioikeuksin toimivalle kerääjälle uutta suoritettavaa
ohjelmaa. Myös kuunteluosoite sekä käyttöliittymän ja tilatietojen hakemistot
säilyvät ylläpitäjän asetuksina. Kun vaihdat datan tai liitoskohdan polkua,
aja tavallinen asennin uudelleen. Se tarkistaa polut ja päivittää kerääjän
systemd-liitosriippuvuuden käynnistäen vain monitorin omat palvelut uudelleen.

HTTP-prosessi voi kirjoittaa vain omaan Asetukset-alihakemistoonsa. Mittaushistoria
ja palkkiotietokannat ovat sille edelleen vain luettavia. Virheellinen
tallennettu asetustiedosto on asetusvirhe, jota ei ohiteta huomaamatta. Säilytä
asetusten ja kirjanpidon varmuuskopiot erillään lähdekoodista. Varmuuskopioi
Asetukset-tiedosto yhdessä perusasetusten ja monitorin tilatietojen kanssa.

## Käyttöoikeudet ja palkkiot

Sovelluksessa ei ole erillisiä katselu- ja ylläpitäjätunnuksia. Kaikki asennukseen
pääsevät käyttäjät voivat muuttaa sen muokattavia asetuksia. Käytä SSH-tunnelia
tai kirjautumisella suojattua HTTPS-välityspalvelinta. Suojaa koko osoite,
myös kaikki Asetukset-API:n polut; CSRF-suojaus ei ole käyttäjän tunnistautuminen.
Jos välityspalvelin muuttaa HTTP-pyynnön Host-otsaketta, lisää täsmällinen
julkinen HTTPS-origin ylläpitäjän perusasetusten `settings_allowed_origins`-listaan.
Oletus on tyhjä lista; tavallinen suora yhteys ei tarvitse lisäystä. Lisää
esimerkiksi `"settings_allowed_origins": ["https://node.example.com"]` nykyisen
JSON-olion kentäksi säilyttäen muut asetukset. Käytä omaa osoitettasi ilman
polkua tai loppukauttaviivaa. Käynnistä sitten vain monitorin HTTP-palvelu uudelleen:

```bash
sudo systemctl restart nodus-monitor.service
```

Tämä sallii Asetukset-pyynnöt kyseisestä originista välityspalvelimen kautta.
Se ei tunnista käyttäjiä tai avaa kuunteluosoitetta. Välitettyihin
host-otsakkeisiin ei luoteta automaattisesti. Katso
[etäkäytön ohje](remote-access_fin.md).

Palkkiot ovat edelleen havaintoja **omistajalompakon** maksuista. Seurattavien
roolien tai näkymän vaihto ei erittele yhdistettyjä lompakkomaksuja storage- ja
witness-tuloiksi. Lähteen poistaminen käytöstä ei poista sen aiemmin kirjattuja
palkkioita. Katso [palkkioiden aineisto ja kirjanpito](../rewards/README_fin.md).
