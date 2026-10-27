# Lompakon selainliitäntä

[English](BROWSER_UI.md)

Avaa observatoriosta **Test DeFi**, osoite `/#defi`.

| Näkymä | Mitä se tekee |
| --- | --- |
| Lompakko | Yhdistää TronLinkin, lukee testiverkon TRX- ja test-USDT-saldot ja valmistelee testitokenin siirron allekirjoitettavaksi. |
| Nodus-lainat | Lukee jo testatun OSD6-lainasopimuksen tarjoukset ja lainat omalta Nodus-nodelta. |
| Harjoittelu | Aiempi paikallinen lainasimulaatio; tapahtumat eivät siirrä varoja. |

Paina TronLinkin yhdistämispainiketta ja hyväksy yhteys lompakossa. Nile on
oletusverkko. Sovellus tarkistaa testiverkon ja tilin ennen siirtoa.
Mainnetissä tapahtumia ei voi valmistella. Tilin tai verkon vaihtuminen
mitätöi valmistellun siirron ja aiemmat saldot.

Syötä vastaanottajan TRON-osoite ja määrä, enintään kuusi desimaalia. Tarkista
lomakkeen vierestä lähettäjä, vastaanottaja, token, määrä ja energiamaksun
yläraja. Hyväksymispainike avaa TronLinkin allekirjoitusikkunan. Energiamaksun yläraja
on 100 TRX. Se ei ole arvio toteutuvasta kulusta; kaistanleveys ja muut maksut
voivat lisätä TRX-kuluja. Testitokeneilla ei ole arvoa.

Selain tallentaa allekirjoitetun tapahtuman tunnisteen ennen lähettämistä. Jos
tallennus on estetty, tapahtumaa ei lähetetä. Lähetyksen hyväksyminen ja ketjun
vahvistama onnistuminen näytetään erikseen. Epäselvä lähetys jää odottamaan
tarkistusta; sitä ei toisteta automaattisesti. Historia on selainkohtainen ja
rajattu verkon sekä tilin mukaan. Sivun yhteyden katkaiseminen ei peruuta
TronLinkille aiemmin annettua sivuston käyttöoikeutta.

Verkot määritellään tiedostossa `frontend/networks.js`. Nilen virallisen
testifaucetin token on `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`. Shastan profiili
on mukana, mutta sen tokenosoite odottaa tarkistettua käyttöönottoa. Verkon
vaihtaminen ei siirrä sopimuksia, saldoja eikä lainoja toiseen ketjuun.

Nodus-lainat tulevat osoitteesta `GET /api/test-defi`. Palvelin tarkistaa tuoreen
synkronointitiedon ja kysyy vain ennalta määritellyt lukufunktiot paikalliselta
nodelta. Selain ei voi valita sopimusta, RPC-osoitetta, allekirjoitusavaimia tai
mielivaltaista funktiota. Tulokset ovat yhden noden ilmoittamia tietoja; mukana
ei ole riippumatonta ketjutodistusta tai sopimuskoodin varmistusta. OSD6 ja
TRONin test-USDT ovat eri tokeneita. Näkymä näyttää enintään 20 uusinta lainaa
ja kertoo mahdollisesti puuttuvasta historiasta. Kyselyt eivät muodosta yhtä
atomista tilannekuvaa.

Nodus-lompakon tutkitusta versiosta ei löytynyt dokumentoitua selaimen
allekirjoitusliitäntää. Nodus-lainatoimintoja ei vielä voi allekirjoittaa
tältä sivulta. Avaimia tai palautussanoja ei tuoda observatorioon. Aiempi
manuaalinen lompakkotestipaketti säilyy käytettävissä.

Ketjujen välinen laina tarvitsee vielä sopimukset ja sovitun selvitysmallin:
NODUS-vakuuden lukituksen, TRON-tokenien säilytyksen ja vapautuksen,
takaisinmaksun, aikarajat, maksulaiminlyönnit ja virhetilanteista palautumisen.
Kahden lompakon yhdistäminen ei yksin toteuta tätä. Selainliittymä ei lähetä
lainan hyväksyntöjä tai ketjujen välisiä varojen lukituksia.

Asenna Nexukselle normaalisti `sudo bash backend/install.sh`. Aiempi
asetustiedosto ja GeoIP säilytetään. Käytä tuttua SSH-tunnelia localhostiin tai
asetettua suojattua HTTPS-osoitetta. Jos välityspalvelin asettaa oman CSP:n,
sen pitää sallia samat Nilen/Shastan RPC-osoitteet kuin observatorion palvelimen.

Tarkat rajaukset, lähteet ja testausohjeet ovat
[englanninkielisessä oppaassa](BROWSER_UI.md).
