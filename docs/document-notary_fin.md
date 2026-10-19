# Asiakirjarekisteri — kokeellinen testnet-toiminto

[English](document-notary.md) · **Suomi**

Asiakirjarekisteri kirjaa julkaisijan väitteen tiedoston SHA-256-tiivisteestä
Noduksen älysopimukseen. Valitsemalla tiedoston myöhemmin uudelleen voi tarkistaa,
vastaavatko sen tarkat tavut valitun julkaisijan rekisteröintiä. Asiakirjaa ei
lähetetä eikä tallenneta ketjuun. Rekisteröinti ei vahvista julkaisijan
henkilöllisyyttä tai asiakirjan sisällön totuutta.

Toiminto kuuluu kokeelliseen `feature/contract-studio`-haaraan. Sitä ei ole
yhdistetty `main`-haaraan eikä IMS:iin. Aiempi visuaalinen escrow-editori säilyy
**Esimerkit**-kohdassa osoitteessa `#contracts-escrow`, jossa siihen voi tutustua
ja kokeilla simulaatiota. Oletussivu `#contracts` avaa asiakirjatoiminnot.

## Mitä tarkistuksen tulos tarkoittaa

| Tulos | Merkitys |
| --- | --- |
| Vastaava rekisteröinti | Valittu node ilmoittaa, että juuri tälle tiivisteelle ja julkaisijaosoitteelle on tietue valitussa rekisterisopimuksessa. |
| Rekisteröintiä ei löytynyt | Noden nykytilan mukaan tässä rekisterissä ei ole tietuetta kyseiselle julkaisijalle ja tiivisteelle. Tämä ei todista, ettei tiedostoa olisi rekisteröity muualla. |
| Peruutettu | Tietue on olemassa, mutta julkaisija on merkinnyt sen peruutetuksi. Alkuperäinen lohkonumero ja aikaleima säilyvät. |
| Kysely ei onnistunut | Tarkistusta ei voitu tehdä. Virheellistä tai puuttuvaa vastausta ei tulkita puuttuvaksi rekisteröinniksi. |

Pelkästään **samannäköisellä** tiedostolla ei välttämättä ole samaa tiivistettä.
PDF:n uudelleentallennus, metatietojen muutos tai digitaalisen allekirjoituksen
lisääminen muuttaa tavuja. Paperitulosteesta tehty skannaus on eri tiedosto.
Säilytä rekisteröity alkuperäistiedosto, kun tarvitset tarkan vastaavuuden
tarkistusta.

Tallennettu lohkonumero ja aikaleima ovat arvot, jotka sopimus näkee
`register`-kutsun suoritushetkellä. Ne tukevat väitettä, että vastaava sisältö oli
saatavilla viimeistään kyseisen lohkon vahvistamisen aikaan. Ne eivät todista
asiakirjan laatimispäivää, tarkkaa siviiliaikaa, tekijyyttä, omistajuutta,
oikeudellista pätevyyttä tai sisällön paikkansapitävyyttä. Myös väärennetyn
asiakirjan voi rekisteröidä.

## 1. Valitse tiedosto paikallisesti

Avaa **Sopimusstudio** ja valitse tiedosto asiakirjatoiminnossa. Selain laskee
SHA-256-tiivisteen Web Crypto -toiminnolla. Tiedoston sisältö ei poistu
selaimesta. Nykyinen enimmäiskoko on **64 MiB** tiedostoa kohden. Selain tarvitsee
suojatun yhteyden: HTTPS:n tai seurannan käyttämän paikallisen loopback-osoitteen.

Tiivisteestä tulee rekisteröitäessä julkinen. Se ei suoraan paljasta tiedostoa,
mutta asiakirjan jo tunteva tai sen sisällön arvaava voi laskea oman tiivisteensä
ja etsiä vastaavuutta. Tiivistys ei ole salausta eikä takaa, että ennakoitavan
asiakirjan olemassaolo pysyy salassa.

Valitse **rekisterisopimuksen osoite** ja **julkaisijan Nodus EVM -osoite**.
Molemmissa on `0x` ja sen jälkeen 64 heksadesimaalimerkkiä. Natiivin
Nodus-lompakon 128 merkin sormenjälki on eri tunniste. Julkaisija on lompakko,
josta `register` suoritetaan, ei seurattavan storage noden identiteetti.

## 2. Julkaise rekisteri kerran tai käytä luotettua olemassa olevaa rekisteriä

Lähdekoodi on [ObservatoryDocuments.sol](../contracts/ObservatoryDocuments.sol).
Käyttöliittymä tarjoaa Noduksen address256-Solidity-kääntäjällä tuotetun oikean
ABI:n ja luontitavukoodin. Toistettavan käännöksen viitepaketti on
[document-registry.json](../dist/document-registry.json). Se sisältää lähteen
SHA-256-tiivisteen, kääntäjän version ja ohjelmatiedoston tiivisteen,
suoritusaikaisen tavukoodin ja sen SHA-256-tiivisteen. Nämä tiivisteet kuvaavat
jaettuja tiedostoja, eivät ketjussa olevan sopimuksen automaattista tarkistusta.

Oman rekisterin julkaisu:

1. Tarkista lähdekoodi ja vie rekisterin ABI sekä **luontitavukoodi**.
2. Avaa virallisen [Nodus-lompakon älysopimussivu](https://wallet.nodusnetwork.io/#contracts), avaa lompakon lukitus ja valitse tarvittaessa Nodus.
3. Liitä ABI **ABI**-kenttään ja luontitavukoodi **Bytecode**-kenttään. Valitse **Deploy…**.
4. Sopimuksella ei ole **konstruktoriparametreja**, eikä sen julkaisuun lähetetä **NODUS-arvoa**. Valitse lompakossa **Review deployment** ja tarkista palvelumaksu ennen vahvistamista.
5. Odota, että lompakko ilmoittaa onnistuneesta ketjuun sisällyttämisestä. Tallenna saatu sopimusosoite vientitiedostojen yhteyteen.

Lompakko allekirjoittaa ja lähettää tapahtuman. Observatory ei pyydä
palautussanoja, yksityisavainta tai noden identiteettiä, eikä julkaise sopimusta
puolestasi. Verkon maksuihin tarvitaan natiivia NODUSia. Asiakirjan
rekisteröimistä varten ei tarvitse siirtää pääomaa EVM-saldolle: toiminnot eivät
vastaanota tai siirrä varoja. Ketjuun sisällytetty epäonnistuva tapahtuma voi
silti kuluttaa palvelumaksun.

Hanki olemassa olevan rekisterin osoite ja toteutustiedot luotetusta lähteestä.
Mielivaltaiseen osoitteeseen julkaistu sopimus voi palauttaa keksittyjä tietueita.
Nykyinen Nodus CLI ei tarjoa suoritusaikaisen tavukoodin tai sen tiivisteen
lukukomentoa, joten seuranta **ei automaattisesti varmista julkaistun sopimuksen
koodia**. Odotetun osoitteen valitseminen ja sopimuksen toteutukseen luottaminen
kuuluvat tarkistuksen lähtötietoihin. Viitepaketin tavukooditiiviste ei korvaa
ketjussa olevan koodin riippumatonta tarkistusta.

Voit toistaa viitepaketin käännöksen erikseen hankitulla virallisella
kääntäjällä. Suorita repositoryn hakemistossa:

```bash
python3 tools/contract-studio/compile.py contracts/ObservatoryDocuments.sol \
  --contract ObservatoryDocuments \
  --solc /absoluuttinen/polku/solc-nodus \
  --out document-registry-build
```

Tuloshakemistoa ei saa olla valmiiksi olemassa. Käytä sen tiedostoja
`ObservatoryDocuments.abi.json` ja `ObservatoryDocuments.creation.hex` lompakon
julkaisussa. [Kääntäjäohje](contract-studio_fin.md) sisältää virallisen
address256-kääntäjän latausosoitteen ja kiinnitetyt tiivisteet. Tavallinen
Ethereum-kääntäjä käyttää väärää osoiteleveyttä, eikä sitä saa vaihtaa tilalle.

## 3. Rekisteröi tiiviste lompakossa

1. Liitä julkaistun rekisterin osoite ja sama ABI lompakon älysopimussivulle. Valitse **Open contract**.
2. Etsi `register(bytes32)` ja liitä valitun tiedoston koko SHA-256-tiiviste `digest`-kenttään muodossa `0x` ja 64 heksadesimaalimerkkiä.
3. Käytä julkaisijan lompakkoa. Valitse **Review**, tarkista sopimusosoite ja tiiviste sekä vahvista tapahtuma lompakossa.
4. Odota onnistunutta ketjuun kirjautumista. Käytä Observatoryssa samaa rekisteriosoitetta, kyseisen lompakon EVM-osoitetta ja tiedostoa. Tee sitten uusi ketjutarkistus.

Lompakon avaaminen tai kutsudatan kopioiminen ei vielä rekisteröi tiedostoa.
Tallennettu pyyntö tai viite-JSON ei vahvista ketjukirjausta. Tässä versiossa
allekirjoitettu kirjoitus tehdään vain lompakon tapahtumatoiminnolla. Tutkitusta
lompakon lähdekoodista ei löytynyt URL-muotoa sopimustapahtuman esitäyttämiseen.
Linkki avaa
älysopimussivun ja arvot kopioidaan kenttiin erikseen.

Sopimus erottaa tietueet **julkaisijan osoitteen ja tiivisteen** mukaan. Toinen
julkaisija voi rekisteröidä saman tiivisteen omalla osoitteellaan ilman, että hän
voi varata tai korvata sinun tietuettasi. Kukin julkaisija voi rekisteröidä
tietyn tiivisteen vain kerran. Rekisteröinti ei anna yksinoikeutta sisältöön eikä
todista, että julkaisija oli ensimmäinen sisällön haltija.

## 4. Tarkista tiedosto myöhemmin

Valitse alkuperäinen tiedosto uudelleen, anna sama rekisteri ja odotettu
julkaisija sekä tee uusi ketjukysely. Seurannan rajattu lukurajapinta kysyy
paikalliselta nodelta. Kyselyssä välitetään tiiviste ja julkiset osoitteet;
**tiedostoa ei lähetetä**. Onnistunut vastaus kertoo tietueen olemassaolon,
alkuperäisen lohkon ja aikaleiman, peruutustilan sekä noden kyselykorkeuden.

Tulokset ovat **noden ilmoittamia tietoja**, eivät riippumattomasti tarkistettu
kryptografinen todiste ketjuun kuulumisesta. Noduksen EVM-lukurajapinta raportoi
yhden noden vahvistettua tilaa. Kuitin sisäisen tiivisteen tarkistus ei yksin
sido tulosta varmennettuun ketjusitoumukseen. Tarkista myös verkon tunniste sekä
rekisteri ja julkaisija. Verkon tunniste tulee kerääjän tuoreesta mittauksesta,
eikä sitä sidota kryptografisesti lukukutsun vastaukseen. Mittaus saa olla
enintään 180 sekuntia vanha, ja sen pitää ilmoittaa noden olevan synkronoitu.
Uuden kyselyn korkeus ei saa olla mittauksen korkeutta pienempi. Synkronoitu
node voi silti olla enintään kaksi lohkoa jäljessä, joten uusi rekisteröinti voi
vaatia uuden tarkistuksen. Testnetin nollaus, toinen ketju, toinen rekisteri tai
tavoittamaton node voi estää aikaisemman tuloksen toistamisen.

Vietävä **viite-JSON** auttaa säilyttämään tiivisteen, rekisterin, julkaisijan,
verkon tunnisteen ja mahdollisen ilmoitetun tuloksen. Se ei sisällä asiakirjaa,
ja kuka tahansa voi muokata sitä. Tuonti palauttaa kyselyn lähtötiedot, mutta
**ei todista rekisteröintiä**: ohjelman on laskettava tiedoston tiiviste ja
tehtävä uusi ketjukysely. Säilytä alkuperäinen tiedosto ja tarkistuksen
lähtötiedot erikseen.

Suora lukukysely nykyisellä EVM-toiminnot sisältävällä Nodus CLI:llä:

```bash
nodus-cli -s 127.0.0.1 -p 4001 evm call \
  0xREKISTERIN_OSOITE_64_HEX \
  'record(address,bytes32)(bool,uint256,uint256,bool)' \
  0xJULKAISIJAN_OSOITE_64_HEX \
  0xTIEDOSTON_SHA256_64_HEX
```

Korvaa havainnollistavat arvot oikeilla 32 tavun arvoilla. Ilman `-i`-valitsinta
komento käyttää tilapäistä, muistissa luotua istuntoidentiteettiä. Se ei tarvitse
lompakon avainta eikä allekirjoita tilaa muuttavaa tapahtumaa. Paluuarvot ovat
järjestyksessä `exists`, `blockNumber`, `timestamp`, `revoked`. Onnistunut
puuttuvan tietueen kysely palauttaa `false, 0, 0, false`. Epäonnistunutta kyselyä
ei saa tulkita tällaiseksi vastaukseksi. Seurannan verkkorajapinta rajaa
menetelmän ja tarkistaa parametrit. Se ei ole yleinen RPC-, käännös- tai
tapahtumavälityspalvelu.

## Peruutus

Alkuperäinen julkaisija voi kutsua virallisessa lompakossa `revoke(bytes32)`
samalla tiivisteellä. Tarkista ja vahvista tapahtuma siellä. Tässä mallissa
peruutus on **lopullinen**: se ei poista alkuperäistä tietuetta eikä salli saman
julkaisija–tiiviste-parin rekisteröintiä uudelleen. Toinen julkaisija ei voi
peruuttaa tietuettasi. Muokatulla asiakirjalla on uusi tiiviste, joka
rekisteröidään erikseen.

## Lähteet ja rajaukset

Noduksen lähdekoodin tutkimus perustuu `nocdem/dna`-revision
`908f76102ac3ded448f2c87ac72772e0c02642c0` sisältöön:

- [Lompakon ABI-, julkaisu- ja funktiokutsulomakkeet](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/ui.js)
- [Lompakon älysopimussivun reititys](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/app.js)
- [CLI:n lukukutsut, vastauksen dekoodaus ja tilapäinen identiteetti](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/nodus-cli.c)
- [Lukukyselyjen ja kuittien luottamusrajat](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/rpc.js)
- [Noduksen kääntäjä ja 32 tavun osoitteet](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/evm/solc/README.md)
- [Lompakon kiinnitetty testnet-tunniste](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/nodus/send-module.js)

Sopimuksessa ei ole ylläpitäjää, päivitysmekanismia, tiedostojen tallennusta,
asiakirjan jäsentämistä, henkilöllisyyden vahvistusta, automaattista
allekirjoitusta tai IMS-yhteyttä. Käännös ja automaattiset tarkistukset eivät ole
auditointi eivätkä osoita, että julkaisu ja rekisteröinti olisivat jo
onnistuneet elävässä testnetissä.
