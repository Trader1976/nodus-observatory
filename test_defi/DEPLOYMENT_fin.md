# Julkaiseminen NODUS-testiverkkoon käsin

[English](DEPLOYMENT.md) · [Ominaisuuden ohje](README_fin.md)

Tämä ohje kuvaa käyttäjän tekemän kokeen **OSD6-tokenilla**. OSD6 on erillinen
EVM-token, eikä se ole lompakossa jo oleva natiivi tUSDT. Sillä ei ole katetta,
lunastusoikeutta tai rahallista arvoa. Observatoryn sivu säilyy paikallisena
simulaationa. Alla olevat tapahtumat tehdään käsin lompakon **Smart contracts**
-sivulla.

Käännös ja muistissa suoritetut moottoritestit eivät vielä todista julkaisua
oikeassa verkossa. Kirjaa todelliset kuitit ja lopputila ennen kuin merkitset
oman kokeesi onnistuneeksi.

## 1. Vie lompakossa tarvittavat tiedostot

Aja Observatory-repositorion juuressa Node.js:llä:

```sh
node test_defi/tools/export-wallet-kit.mjs --output ~/nodus-defi-wallet-kit
```

Kohdehakemisto ei saa olla olemassa, mutta sen ylähakemiston pitää olla.
Vienti tarkistaa tallennettujen käännösten rajaukset ja lähdekoodin tiivisteet
sekä luo:

- `SandboxDollar6.abi.json`, `.creation.hex`, `.runtime.hex`, `.sol`;
- `LendingReference.abi.json`, `.creation.hex`, `.runtime.hex`, `.sol`;
- `manifest.json`: tiedostojen tiivisteet, odotettu ketju ja aluksi tyhjät osoitteet.

Vienti ei tarvitse kääntäjää, palautussanoja tai verkkoyhteyttä eikä lähetä
tapahtumia. Älä käytä sen tilalla hyökkäystesteihin tarkoitettua `MockUSDT6`-
aputokenia. Paketin SandboxDollar6 luo kerran 1 000 000 OSD6-tokenia
julkaisijalle. Tokenissa ei ole lisäluontia tai ylläpitäjää.

## 2. Valmistele kaksi erillistä testi-identiteettiä

Käytä luotetussa NODUS-lompakossa erillistä **rahoittajaa** ja **lainaajaa**.
Tässä esimerkissä rahoittaja julkaisee myös sopimukset. Kirjaa molempien täydet
EVM-osoitteet: `0x` ja **64 heksamerkkiä**. Ethereumin 20 tavun osoite tai
natiivin lompakon 128 heksamerkin sormenjälki ei käy tähän.

Molemmilla pitää olla natiivia testnet-NODUSia siirtomaksuihin. Lainaaja
tarvitsee lisäksi vähintään 100 NODUSia vakuudeksi ja erikseen maksuvaraa.
Tässä ei luvata kiinteää siirtomaksua: tarkista jokaisen tapahtuman esikatselu.
Epäonnistunut sopimuksen suorituskin voi kuluttaa ilmoitetun maksun.

Käytä lompakon tukemaa testiverkkoversiota. Pakettiin lukittu ketjutunniste on:

```text
a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114
```

Palautussanat pysyvät lompakossa. Älä syötä niitä Observatoryyn, sen
palvelimelle, lähdekoodiin tai tähän ohjeeseen. Älä käytä samaa identiteettiä
samanaikaisesti toisessa sovelluksessa EVM-tapahtuman ollessa kesken.
Jokainen kirjoittava tapahtuma tarkistetaan ja hyväksytään lompakossa.

## 3. Julkaise token ja sitten lainasopimus

Valitse rahoittaja ja avaa lompakon **Smart contracts** -sivu:

1. Liitä `SandboxDollar6.abi.json`-tiedoston sisältö **ABI**-kenttään ja
   `SandboxDollar6.creation.hex` **Bytecode**-kenttään. Valitse **Deploy…** ja
   **Review deployment**. Rakentajalla ei ole argumentteja, eikä mukana lähetetä
   maksettavaa NODUS-arvoa. Tarkista ja hyväksy tapahtuma lompakossa.
2. Odota onnistunutta kuittia. Kirjaa intent-tunniste, lohkokorkeus ja koko
   luotu osoite vasta, kun osoite täsmää allekirjoitetusta tapahtumasta
   laskettuun osoitteeseen. Pelkkä intent-tunniste ei todista onnistumista.
3. Avaa tokenin osoite sen ABI:lla. Lue `name()`, `symbol()`, `decimals()`,
   `totalSupply()`, `SUPPORTED_CHAIN_ID()` ja `balanceOf(rahoittajanOsoite)`.
   Odotetut tulokset ovat Observatory Sandbox Dollar, OSD6, 6,
   `1000000000000`, lukittu ketju ja sama koko tarjonta julkaisijan saldona.
4. Julkaise `LendingReference` sen ABI:lla ja luontitavukoodilla. Rakentajan
   `tokenAddress` on **vahvistettu OSD6:n EVM-osoite**. Älä lähetä mukana
   maksettavaa NODUS-arvoa. Natiivin tUSDT:n token-ID ei käy tähän kenttään.
5. Tarkista onnistunut kuitti ja luotu osoite samoin. Avaa sopimus sen ABI:lla
   ja lue `token()` sekä `SUPPORTED_CHAIN_ID()` ennen käyttöoikeuden antamista.
   `token()`-tuloksen pitää olla juuri julkaisemasi OSD6:n osoite.

Pidä erillistä kirjaa julkisista osoitteista, paketin tiivisteistä ja kuiteista.
Vientimanifesti on paikallinen kuvaus, ei todistus ketjussa olevasta
julkaisusta. Jos käytössäsi on SDK:n tavukoodin lukija, vertaa
`evm.code(osoite).code`-tulosta tavu tavulta vastaavaan `.runtime.hex`-
tiedostoon. Lompakon yleinen lomake ei itsessään sisällä tätä vertailutyökalua.
`token()`-tuloksen tai kuitin lukeminen ei yksin tarkoita tavukoodin vertailua.

## 4. Kokeile yhtä 100 OSD6:n lainaa

Solidity-funktioiden kokonaislukukenttiin annetaan **kokonaiset raakayksiköt**,
ei desimaalimuotoisia tokenmääriä. Lompakon maksettava **Send with it (NODUS)**
-kenttä toimii toisin: siihen annetaan ihmiselle luettava NODUS-määrä.

| Ehto | Sopimukselle annettava arvo |
| --- | --- |
| Pääoma | `100000000` = 100 OSD6 |
| Vakuus | `100000000000000000000` EVM-wei = 100 NODUS |
| Vuosikorko | `800` korkopistettä = 8 % vuodessa |
| Laina-aika | `30` päivää |
| Lisäaika | `3` päivää |
| Koko laina-ajan korko | `657535` = 0,657535 OSD6 |
| Takaisinmaksu yhteensä | `100657535` = 100,657535 OSD6 |

Korko on `ceil(100000000 * 800 * 30 / (10000 * 365))`. Koko sovittu korko
maksetaan myös välittömässä takaisinmaksussa. Lisäaika ei kasvata korkoa tässä
mallissa. Kuukausieriä ei vielä ole.

**Rahoittajana:**

1. Kutsu OSD6-sopimuksessa `transfer(lainaajanOsoite, 657535)`. Näin lainaaja
   saa korkoa varten lisätokenit, joita pelkästä lainapääomasta ei synny.
   Odota onnistumista ja tarkista `balanceOf(lainaajanOsoite)`.
2. Kutsu OSD6:ssa `approve(lainasopimuksenOsoite, 100000000)`. Lue onnistumisen
   jälkeen `allowance(rahoittajanOsoite, lainasopimuksenOsoite)` ja tarkista määrä.
3. Valitse tuleva Unix-vanhenemisaika sekunteina, enintään 30 päivän päähän.
   Seitsemän päivän päässä olevan ajan alustavan arvion saat omalla koneella:

   ```sh
   python3 -c 'import time; print(int(time.time()) + 7 * 86400)'
   ```

   Sopimus käyttää ketjun lohkoaikaa, ei selaimen kelloa. Vanhentunut tai
   sallitun välin ulkopuolinen aika hylätään. Älä kierrä hylkäystä.
4. Kutsu `createOffer(100000000, 100000000000000000000, 800, 30, 3, expiresAt)`.
   Tämä siirtää pääoman sopimuksen säilytykseen; pelkkä approve ei rahoittanut
   tarjousta. Kirjaa oikea ID `Offered`-tapahtumasta. Uuden sopimuksen ensimmäinen
   onnistunut tarjous on 1, mutta olemassa olevassa sopimuksessa sitä ei oleteta.
5. Lue `getOffer(id)`: tarkista rahoittaja, määrät, tarkka korko, laina-aika,
   lisäaika, vanheneminen ja tila **1 / Open**. OSD6:n
   `balanceOf(lainasopimuksenOsoite)` sisältää nyt varatun pääoman.

**Lainaajana:**

1. Talleta lompakon **Move NODUS to smart contracts** -kohdassa 100 NODUSia
   omaan EVM-saldoosi, jos sitä ei jo ole. Tämä on erillinen tapahtuma eikä
   vielä rahoita lainasopimusta. Säilytä natiivia NODUSia siirtomaksuihin.
2. Avaa sama lainasopimus sen ABI:lla ja tarkista `getOffer(id)` itse. Kutsu
   `accept(id)` ja anna **Send with it (NODUS) = `100`**. Älä anna tähän
   kenttään 21-numeroista wei-lukua. Vakuuden pitää täsmätä tarkasti.
3. Tarkista onnistumisen jälkeen tila **2 / Active**, lainaaja, aloitus-, erä-
   ja lisäajan päättymishetki sekä OSD6-saldo `100657535`. Lainasopimus maksoi
   100 OSD6:n pääoman. Ylimääräiset `657535` raakayksikköä tulivat erillisestä
   testisiirrosta.
4. Kutsu OSD6:ssa `approve(lainasopimuksenOsoite, 100657535)`, odota onnistumista
   ja kutsu lainasopimuksessa `repay(id)` ennen määräaikaa. Takaisinmaksun mukana
   ei lähetetä maksettavaa NODUS-arvoa. Tarkista tila **3 / Repaid**.
5. Lue `collateralCredit(lainaajanOsoite)` ja kutsu
   `withdrawCollateral(lainaajanOsoite)`. Saat 100 NODUSia **EVM-saldoosi**.
   Sen muuttaminen takaisin natiiviksi NODUSiksi vaatii lompakon erillisen
   **Move NODUS back** -toiminnon.

**Rahoittajana:** lue `tokenCredit(rahoittajanOsoite)` = `100657535` ja kutsu
`withdrawToken(rahoittajanOsoite)`. Tarkista, että hyvitys nollautuu ja OSD6-
saldo kasvaa tarkalleen sillä määrällä. Lainan tilitys ja varojen nosto ovat
eri toimintoja: maksettu laina ei tarkoita jo nostettuja hyvityksiä.

## 5. Peruminen, maksamatta jääminen ja epävarma tulos

Rahoittaja voi perua käyttämättömän **Open**-tarjouksen kutsulla `cancel(id)`.
Se luo tokenhyvityksen, joka nostetaan erikseen `withdrawToken`-kutsulla.

Tässä kokeellisessa sopimuksessa rahoittaja voi lunastaa **koko vakuuden**
`claimDefault(id)`-kutsulla hetkellä `dueAt + grace` tai sen jälkeen.
Takaisinmaksu sulkeutuu juuri samalla rajalla. Lunastus luo erikseen nostettavan
vakuushyvityksen. Mallissa ei ole hintaoraakkelia, velan markkina-arvoon
rajoitettua lunastusta tai markkina-arvon ylijäämän palautusta. Vakuus voi
menettää arvoaan velkaa pienemmäksi tai lunastus voi ylittää velan arvon.
Tämä on testin tilityssääntö, ei tuotantolainauksen malli. Kokeile maksamatta
jäämistä toisella pienellä testitarjouksella. Simulaation aikapainikkeet eivät
siirrä oikean ketjun lohkoaikaa.

Odota jokaisen tapahtuman lopullinen kuitti ennen jatkamista. Jos yhteys
katkeaa, tapahtuma on kesken tai tulos ei ole tiedossa, tarkista alkuperäinen
intent ja vahvistettu tila. Älä toista `deploy`-, `createOffer`- tai muita
kirjoittavia toimintoja selvittääksesi, onnistuiko ensimmäinen. Säilytä
lompakon pending- ja tapahtumahistoria. Tämä ohje ei tee automaattisia uusintoja.

Julkaistut sopimukset ovat erillisiä Observatoryn selainluonnoksista ja
simulaatiosta. Luonnoksen muuttaminen, tuominen tai nollaaminen ei muuta niitä.
Tämä menettely ei vielä yhdistä luottopisteitä, natiivia tUSDT:tä,
automaattisia chat-viestejä tai yhteistä tarjoushakemistoa.

## Tarkistetut alkuperäislähteet

- [Lompakon yleinen julkaisu- ja ABI-lomake](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/src/evm/ui.js)
- [SDK:n toiminnot, osoite- ja rahayksiköt sekä tapahtumien tulokset](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/js/README.md)
- [Starterin hyväksyntä, paikalliset avaimet ja pysyvä pending-kirjanpito](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/starter/README.md)
- [SDK:n yleisen julkaisemisen ja lähettämisen toteutus](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/js/src/sdk.js)
