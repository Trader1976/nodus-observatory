# Observatoryn Test DeFi -perusta

[English](README.md)

Tämä hakemisto sisältää Test DeFi -osion lähdekoodin. Avaa Observatoryn
**Test DeFi** (`/#defi`), luo lainatarjous ja harjoittele lainaamista
NODUS-vakuutta vastaan. Sivu toimii nyt **paikallisena simulaationa**:
rahoitus, summat ja takaisinmaksut ovat selaimen harjoitustietoa. Ne eivät ole
lompakon saldoja tai ketjutapahtumia. Sivu ei pyydä palautussanoja, yhdistä
lompakkoa tai lähetä transaktioita.

## Lompakon tUSDT ja sopimuksen testitoken ovat eri asioita

Nodus Walletissa näkyvä tUSDT on **NODUSin natiivi UTXO-token**, jolla on
64 tavun token-tunniste. Se ei ole ERC20-sopimusosoite. Tarkistettu virallinen
lompakkolähde määrittää tokenin nimellä **Test USDT / tUSDT**, kuudella
desimaalilla. Token luotiin testiverkon lohkossa 305991:

```text
7142460f5dd73ce7123905c423e1eb17fbff36f14b031e24837a4b6d7bedd5677baaa3a3e6015e6d6fc706b0b0d8799a88d7fd63f6d1e7807dbb88577b7c3b50
```

Tarkistetussa lähdekoodiversiossa EVM:n rahoituspolku hyväksyy vain natiivin
NODUS-kolikon. DEPOSIT-operaatio sisältää summan ja noncen, ei token-tunnistetta.
Konsensuskoodi hylkää rahoituskolikot, joiden token ei ole natiivi NODUS.
Siksi tavallinen ERC20:n `approve` / `transferFrom` ei voi käyttää lompakon
nykyistä tUSDT:ta. Puuttuva ominaisuus on natiivien tokenien sopimuskäyttö,
ei asetuksiin täydennettävä ERC20-osoite.

Selainmalli käyttää suunnitellun käyttökulun harjoitteluun simuloitua,
kuusidesimaalista tUSDT:ta. Erillinen Solidity-viitesopimus käyttää
**MockUSDT6**-aputokenia suljetussa EVM-testissä. Sitä voi luoda vapaasti,
eikä se ole lompakon tUSDT. Käännöstulosten `nativeTusdtCompatible: false`
ilmaisee eron koneellisesti. Tässä ei toteuteta käärittyä tokenia, siltaa,
palvelimen säilyttämää token-siirtopalvelua tai oikeaa lainapalveluasennusta.

## Ensimmäisen version lainasäännöt

| Asia | Sääntö |
| --- | --- |
| Tarjous | Yksi kokonaan rahoitettu tarjous muuttuu yhdeksi kokonaiseksi lainaksi. Osittaisia täyttöjä ei ole. |
| Pääoma | Positiivinen kuusidesimaalinen tokensumma, mallissa enintään `10^24` raakayksikköä. |
| Vakuus | Rahoittajan valitsema kiinteä NODUS-määrä, kahdeksan näyttödesimaalia. |
| Korko | Kiinteä yksinkertainen vuosikorko, 1–5000 korkopistettä eli 0,01–50 %. |
| Laina-aika | 1–365 päivää tarjouksen hyväksymisestä. |
| Tarjouksen voimassaolo | Selaimen luonnoksilla 1–30 päivää luomisesta; hyväksyminen päättyy umpeutumishetkellä. |
| Lisämaksuaika | 1–30 päivää eräpäivästä; mallissa ei ole erillistä viivästysmaksua. |
| Takaisinmaksu | Yksi maksu: pääoma ja koko sovitun laina-ajan korko. Myös aikainen takaisinmaksu maksaa koko koron. |
| Käyttämättömät varat | Rahoittaja voi perua avoimen tarjouksen. |
| Maksulaiminlyönti | Eräpäivän ja lisämaksuajan jälkeen takaisinmaksu sulkeutuu ja rahoittaja voi lunastaa koko sovitun vakuuden. |

Koko vakuuden lunastus on tarkoituksellinen kokeellinen yksinkertaistus.
Se ei rajoita lunastusta velan markkina-arvoon eikä palauta vakuuden
markkina-arvon mahdollista ylijäämää. Mallissa ei ole hintaoraakkelia,
reaaliaikaista vakuussuhdetta, hintaan perustuvaa likvidointia, taattua tuottoa
tai suojaa vakuuden arvon laskulta. Tämä sääntö pitää suunnitella uudelleen
ennen tuotantotasoista luottomarkkinaa.

Korko lasketaan kerran kokonaisluvuilla ja pyöristetään ylöspäin pienimpään
tokenyksikköön:

```text
korkoRaw = ceil(pääomaRaw * korkopisteet * päivät / (10000 * 365))
takaisinmaksuRaw = pääomaRaw + korkoRaw
```

Tässä versiossa ei ole kuukausieriä. Credit score, Proof of Life,
chat-muistutukset, usean rahoittajan yhteinen laina ja jaettu tarjouskirja
kuuluvat jatkokehitykseen. Esimerkkien 8 % ja 10 % tarjouksissa ei ole
luottopisterajoja.

## Koodin rakenne

| Polku | Vastuu |
| --- | --- |
| `frontend/core.js` | Tarkat summat, korkolaskenta, tarjousten validointi ja tapahtumahistoriasta tarkistettavat simulaatiotilat. Ei verkkoyhteyksiä tai tallennusta. |
| `frontend/defi.js`, `frontend/defi.css` | Suomen- ja englanninkielinen sivu sekä rajatut responsiiviset tyylit. |
| `sync_frontend.py` | Kopioi alkuperäiset lähteet julkaistavaan `dist/test-defi`-hakemistoon. `--check` hylkää erot. |
| `contracts/LendingReference.sol` | Erillinen ERC20-viitesopimus: rahoitettu tarjous, natiivi vakuus, lainan selvitys ja nostettavat hyvitykset. |
| `contracts/MockUSDT6.sol` | Vapaasti luotava testitoken ja virhetilanteiden apusopimukset. |
| `artifacts/reference.json` | Toistettava ABI/tavukoodi, lähdetiivisteet, kääntäjän tunniste ja yhteensopivuusrajaus. |
| `tools/`, `tests/` | Lukittu kääntäjä, suoritusympäristön testit sekä talous- ja tilasiirtymien tarkistukset. |
| `config.example.json` | Tutkittu tunnistetieto. Suoritus on pois käytöstä ja asennetut sopimusosoitteet puuttuvat. Sivu ei lataa tätä aktiiviseksi verkkoasetukseksi. |

Solidity-sopimus erottaa lainan selvityksen varojen nostosta. Peruminen ja
takaisinmaksu luovat tokenhyvityksiä; takaisinmaksu ja laiminlyönti luovat
vakuushyvityksiä. Hyvityksen omistaja nostaa varat valitsemaansa osoitteeseen.
Jos nosto epäonnistuu, hyvitys säilyy. Näin esimerkiksi natiivimaksun
hylkäävä vastaanottajasopimus ei estä lainan selvitystä. Token-siirroista
tarkistetaan paluuarvo sekä tarkat saldomuutokset. Pahantahtoisen tokenin
luotettavuutta nämä tarkistukset eivät ratkaise.

Summat kulkevat rajapinnassa desimaalijonoina, ja laskenta käyttää `BigInt`-arvoja.
NODUSissa on kahdeksan natiivia desimaalia ja NODUS EVM:ssä kahdeksantoista:
`1 raaka NODUS-yksikkö = 10^10 EVM wei`. Vakuus hyväksytään vain kokonaisina
natiiveina raakayksikköinä. Mallin suuri laskentaraja ei ole lupaus natiivin
UTXO-siirron tukemasta summasta: tulevan sovittimen pitää tarkistaa myös
ketjun todelliset summa- ja tapahtumarajat.

## Tarkistus ja esikatselu

Aja repon juuressa:

```sh
python3 test_defi/sync_frontend.py
python3 test_defi/sync_frontend.py --check
node test_defi/tests/core.mjs
node test_defi/tests/frontend.mjs
python3 -m http.server 8891 --directory dist
```

Avaa `http://127.0.0.1:8891/#defi`. Observatoryn tavallinen asentaja asentaa
generoidun käyttöliittymän. Asentaminen ei julkaise älysopimuksia eikä kytke
lompakkotapahtumia käyttöön.

Viitesopimuksen käännöksen tarkistamiseen aseta `NODUS_SOLC` osoittamaan
lukittuun NODUS addr256 -kääntäjään ja aja:

```sh
node test_defi/tools/build-contracts.mjs --check
```

Vaadittu kääntäjä on `0.8.30+nodus.addr256.commit.73712a01.Linux.g++`.
Ethereumin tavallinen Solidity käyttää 20 tavun osoitteita eikä korvaa sitä.
Sopimuksen suoritustestin skripti ja CI määrittävät lukitun NODUS-moottorin
version sekä käännösriippuvuudet. Paikallinen suorituskoe ei tarkoita oikeassa
testiverkossa tehtyä lainaa.

Aseta `NODUS_EVM_ROOT` osoittamaan version
`nocdem/dna@2e881cc6e6d7a5050cc10400afc2b883f8fb712a` lähdekoodiin ja aja
32 tavun osoitteita käyttävän muistissa suoritettavan moottoritestin komento
`node test_defi/tools/test-contracts.mjs`.

## Ennen oikeita testiverkon lainoja

1. Sovitaan ja toteutetaan konsensuksen valvoma natiivin tokenin lukitus- ja
   selvitysrajapinta tai valitaan avoimesti erillinen testivaramalli.
   Palvelimen siirtämä tUSDT ei vastaa itsenäistä älysopimussäilytystä.
2. Tarkistetaan ketju, täsmällinen token-tunniste ja metadata, asennetun
   sopimuksen koodi/ABI sekä yksiköt vahvistetusta ketjutilasta. Symboli ei
   riitä tunnisteeksi eikä natiivin tokenin tunniste ole ERC20-osoite.
3. Liitetään tuettu lompakkohyväksyntä, allekirjoitettavan tapahtuman
   tarkistettava sisältö sekä pysyvä odottavien tapahtumien kirjanpito ja
   täsmäytys. Avaimia ei tuoda Observatoryn palvelimeen tai tälle sivulle.
4. Rakennetaan ketjusta luettava yhteinen tarjouskirja ja vahvistettu
   lainahistoria. Tuotu luonnos tai onnistunut simulaatio ei ole todiste
   rahoituksesta, takaisinmaksusta tai credit scoresta.
5. Suunnitellaan vakuuden realisointi, hinnan lähde ja virheistä palautuminen.
   Testataan myös hyökkäykset ennen oikean arvon käyttöä. Myöhemmissä
   mainetodisteissa määritellään erikseen myöntäjien ja laskentasääntöjen
   luottamus sekä todistusten voimassaolo.

## Tarkistetut ensisijaiset lähteet

Linkit on lukittu versioon `nocdem/dna@d065cf3db719f990fe3777237af0f7166d5a5330`:

- [Lompakon natiivi tUSDT-tunniste ja metadatan tarkistus](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/crypto/nodus-send-wasm.c)
- [Natiivien tokenien lompakkotestit](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/test/nodus-tokens.test.js)
- [EVM-rahoituksen viestimuoto](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/shared/dnac/evm_call_wire.h)
- [Konsensuskoodin natiivin EVM-rahoituksen tarkistukset](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/nodus/src/witness/nodus_witness_rt_native.c)
- [Natiivien ja EVM-yksiköiden muunnos](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/src/evm/units.js)
- [Node.js SDK ja lompakon hyväksyntä-/odotustilamalli](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/js/README.md)
