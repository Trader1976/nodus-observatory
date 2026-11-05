# Trade / Swap — NODUS ja USDT BNB Smart Chainissa

Yläreunan **Kaupankäynti** avaa `#trade`-alueen. Kauppahinta ilmoitetaan USDT:nä
BNB Smart Chainissa (BSC). Tämän version suoritettava testiprofiili on
**Nodus testnet + BSC-testiverkko 97 + TEST-USDT**. TEST-USDT on oma vapaasti
luotava 18 desimaalin testitoken, jolla ei ole rahallista arvoa. Verkkokulut
maksetaan erikseen tBNB:nä.

Tavoiteltu pääverkon valuutta on **Binance-Peg USDT (BSC-USD)** BSC-verkossa 56,
sopimus `0x55d398326f99059ff775485246999027b3197955`, 18 desimaalia. Se on
USDT:n Binance-Peg-edustus, ei sama liikkeeseenlasku kuin Tetherin Ethereum-
tai Tron-USD₮. Pääverkon tiedot ovat tässä versiossa vain vertailutietoa; oikean
USDT:n kaupankäyntiä ei ole avattu. Token tunnistetaan aina verkon ja tarkan
sopimusosoitteen perusteella.

## Mitä voi tehdä nyt

Työpöydässä voi tehdä ja tallentaa tarjouksia, jakaa julkisen tarjoustiedoston,
säilyttää salaisuuden yksityisessä palautustiedostossa, simuloida käyttölupaa,
lukituksia, lunastuksia ja palautuksia sekä ladata tapahtumasuunnitelmat ja
käännetyt sopimukset. Näkymässä on FIN/ENG ja mobiiliasettelu.

P2P-valmisteluun kuuluvat saman Observatory-asennuksen käyttäjien yhteiset
ilmoitukset, lyhyet varaukset, kauppaistunnot,
lompakkopyyntöjen valmistelu ja ketjun tilan lukeminen. Ilmoitus tai varaus on
**allekirjoittamatonta ja todentamatonta tietoa**. Se ei todista lompakon omistusta,
saldoa, lukitusta tai kaupan toteutumista. Ilmoitustaulu ei säilytä varoja.
Tarjouksen voi edelleen jakaa myös tiedostona.

Selaimen BSC-lompakolta voidaan pyytää käyttäjän erikseen hyväksymiä toimintoja
verkossa 97. Nodus-lompakkopyyntö on allekirjoittamaton kehittäjälle tarkoitettu
siirtotiedosto: virallinen lompakko ei vielä tue sen tuontia kolmannen osapuolen
maksupyyntönä. Nykyinen Nodus-CLI voi lukea lukituksen ja sopimuksen kellon, mutta
ei julkaistua ohjelmakoodia. Verkon tunniste tulee paikallisesta seurantatiedosta,
eikä tätä lukupolkua ole riippumattomasti varmennettu. Ilman todettua Nodus-koodia ja vahvistettuja
lukituksia varojen lukitseminen ja salaisuuden paljastaminen pysyvät estettyinä.
Simulaation onnistuminen ei poista estettä.

[Englanninkielinen lompakkoliitännän kehittäjäohje](trade-wallet-request.md)
erottaa valmiin valmistelun puuttuvista allekirjoitus- ja tarkistustoiminnoista.

## Kaupan malli

**Myy NODUS:** tekijä lukitsee NODUSit ensin. Vastapuoli lukitsee TEST-USDT:t.
Tekijä lunastaa TEST-USDT:t salaisuudella. Vastapuoli näkee salaisuuden tästä
lunastuksesta ja lunastaa sillä NODUSit.

**Osta NODUS:** tekijä lukitsee TEST-USDT:t ensin. Vastapuoli lukitsee NODUSit.
Tekijä lunastaa NODUSit ensin ja vastapuoli sen jälkeen TEST-USDT:t.

BSC-puolella annetaan ensin varmennetulle vaihtosopimukselle käyttölupa täsmälleen
sovitulle tokenmäärälle. Sen jälkeen tehdään lukitus. Jos aiempi käyttölupa on
ei-nolla, se voidaan joutua nollaamaan ennen uuden luvan antamista. Suunnitelma
sisältää tämän vaiheen. Kauppasummaa ei lähetetä BNB:nä; BNB maksaa vain
verkkokulut. Molemmat omaisuudet pysyvät omissa verkoissaan.

## Kokeile näkymää

1. Valitse **Luo esimerkkikauppa**. Sen lompakko- ja tokenosoitteet ovat
   kuvitteellisia.
2. Valitse **Testaa kauppa → Aloita simulaatio**.
3. Anna BSC-puolella käyttölupa täsmälleen sovitulle testitokenmäärälle. Lukitse
   tekijän varat ensin ja vastapuolen varat toisena.
4. Kokeile väärää salaisuutta, lunasta tekijänä lyhyempi lukitus ja vastapuolena
   pidempi lukitus. Kokeile myös määräaikoja ja palautuksia.

Omaa erikseen julkaistavaa testisopimusta varten avaa **Uusi tarjous**, anna nimi,
suunta, summat, neljä oikeaa testilompakon osoitetta ja julkaistun `MockUsdt`-tokenin
osoite. Nodus EVM -osoite on `0x` + 64 heksamerkkiä, BSC-osoite `0x` + 40.
Noduksen 128 merkin sormenjälki ei ole EVM-osoite. Testitokenilla on 18 desimaalia;
Ethereum-USDT:n kuuden desimaalin oletusta ei käytetä.

## Tallennus, ilmoitukset ja palautuminen

Uudet tarjoukset käyttävät `nodus-trade/offer-v2`-muotoa, `usdtAmount`-summaa,
osapuolten `{nodus, bsc}`-osoitteita sekä tarkkaa testitokenin tunnistetta.
Selaimeen tallentuu korkeintaan 50 julkista tarjousta `nodus-trade/book-v2`-muodossa.
Vanha BNB-tarjousluettelo säilytetään erillään ja sen voi ladata **Vie vanhat
BNB-tarjoukset** -toiminnolla. BNB-tarjouksia tai niiden palautustiedostoja ei
tulkita automaattisesti USDT-kaupoiksi.

**Vie yksityinen palautustiedosto** tallentaa tarjouksen ja 32 tavun salaisuuden
`nodus-trade/recovery-v2`-muodossa. Vie se ennen sivun sulkemista ja pidä se
itselläsi. Julkinen tarjous, ilmoitus tai julkinen istuntotiedosto ei saa sisältää
salaisuutta. Julkisen tiedoston tuonti ei palauta sitä. Salaisuus luodaan selaimen
kryptografisella satunnaislukugeneraattorilla, ja SHA-256 lasketaan 32 raakabittitavusta.
Virheellistä tai epäonnistunutta vanhaa selaintallennusta ei ylikirjoiteta.

Palautusrajat alkavat tarjouksen luonnista: tekijälle 24 tuntia ja vastapuolelle
12 tuntia. Ne eivät ala talletuksesta tai varauksesta. Aikarajojen välin pitää
olla vähintään kaksi tuntia. Sopimus hyväksyy uuden lukituksen vain, kun sen
palautusrajaan on 1 tunti – 7 päivää. Nämä ovat testikäytön oletukset.

Koko tarjouksen varaus vanhenee viimeistään 10 minuutissa tai ilmoituksen
vanhetessa. Sen jälkeen tarjouksen voi varata uudelleen. Yksityinen hallintatiedosto
antaa oikeuden poistaa ilmoituksen silloin, kun aktiivista varausta ei ole.
Ilmoituksen poistaminen tai varauksen vanheneminen ei peruuta ketjulukitusta.
Hallintatiedosto ei todista lompakon omistusta tai maksukykyä.

## Sopimukset ja testijulkaisu

Sopimusten lataus sisältää `ObservatoryNodusSwap`, `ObservatoryBscUsdtSwap` ja
`MockUsdt`-lähdekoodit, ABI:t ja luontitavukoodit. Julkaise BSC-testiverkkoon ensin
`MockUsdt` ja anna sen osoite vaihtosopimuksen rakentajalle. Tokenin `faucet()`
luo kutsujalle miljoona TEST-USDT:tä kerrallaan, ja kutsun voi toistaa. Tokenilla
ei ole vakuutta tai rahallista arvoa.

BSC-vaihtosopimuksen tokenosoitetta ei voi vaihtaa julkaisun jälkeen. Sen
`open(bytes32,address,bytes32,uint256,uint64)` siirtää käyttölupaan perustuvan
tokenmäärän. Se ei hyväksy BNB-kauppasummaa. Tarkat saldomuutokset tarkistetaan;
siirtoverollisia tai muuttuvan saldon tokeneita ei tueta. Epäonnistuminen peruu
koko toiminnon. Sopimuksessa ei ole ylläpitäjän tyhjennystoimintoa.

Uusi Nodus-sopimus sisältää `currentBlockTime()`-kellolukeman. Vanhaa BNB-prototyypin
aikaista julkaisua ei voi käyttää uuden sopimusversion tilalla. Nodus-julkaisun
CLI-ohje ja yksikkömuunnokset ovat [kehittäjäohjeessa](trade-swap.md#manual-nodus-test-deployment).
Avaimet pidetään omassa testilompakossa; niitä ei ladata Observatoryyn.

Ennen varojen lukitsemista tai salaisuuden paljastamista pitää tarkistaa
**molempien verkkojen julkaistu koodi, vahvistetut lukitukset ja riittävä aikamarginaali**.
Tarkistuksiin kuuluvat verkko, sopimus, tokenosoite ja desimaalit, osapuolet,
kaupan tunniste, täsmälliset summat, tiiviste, määräajat ja tila. Pelkkä
transaktiohash, ilmoitus, ladattu JSON tai simulaatio ei riitä. Nykyisen Nodus-CLI:n
lukema lukitus jää todentamattomaksi, koska julkaistua koodia ei voi lukea sillä.

Salaisuus voi näkyä lompakolle, RPC-palvelulle tai odottavan tapahtuman datassa jo
ennen vahvistusta. Myös lunastuksen kulujen arviointi tehdään vasta tarkistusten
jälkeen. Kauppaa seurataan loppuun asti. Määräajan umpeutuminen tekee palautuksen
mahdolliseksi, mutta palautus tarvitsee oman tapahtuman ja verkkomaksun.

Kääntäjät, toistettavat testit ja tekniset rajapinnat:
[trade-swap.md](trade-swap.md). Paikalliset tavukooditestit eivät ole ulkoinen
auditointi tai kahden oikean testiverkon lompakoilla tehty päästä päähän -koe.

Ilmoitustaulu tallentuu palvelimen `<state_dir>/trade/board.sqlite3`-tietokantaan.
Sillä voi olla enintään 100 aktiivista ilmoitusta. **Vie ilmoituksen yksityinen
hallintatiedosto** ennen sivun sulkemista; palvelin palauttaa hallintatunnisteen
vain kerran ja tallentaa siitä tiivisteen. Tiedosto hallitsee ilmoitusta, ei
lompakkoa. Säilytä myös kaupan palautustiedosto ja julkinen istuntotiedosto
riippumatta tästä palvelimesta.

Etäkäytössä käytetään Observatoryn nykyistä tunnistautuvaa välityspalvelua.
Saman alkuperän ja CSRF-tarkistukset suojaavat selaimesta tehtäviä muutoksia,
mutta eivät todista ilmoittajan lompakon omistusta. Taulu ei ole yleinen
hajautettu tarjouskirja.
