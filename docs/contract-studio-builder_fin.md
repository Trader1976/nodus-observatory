# Visuaalinen sopimuseditori

[English](contract-studio-builder.md) · **Suomi**

Visuaalisella editorilla osoitteessa `#contracts-editor` voi rakentaa muokattavan
tilakoneen. Se laajentaa aiempaa [escrow-esimerkkiä](contract-studio_fin.md):
tilat, kutsuttavat toiminnot, ehdot ja roolit ovat muokattavia osia vietävässä
sopimuksessa. [Asiakirjarekisteri](document-notary_fin.md) säilyy erillisenä työtilana.

Editori toimii paikallisesti selaimessa. Se vie projektin ja Solidity-lähdekoodin;
se ei muodosta lompakkoyhteyttä, allekirjoita transaktioita tai julkaise
sopimuksia. Seurantapalvelimelle ei lisätä kirjoittavaa rajapintaa.

## Rakenna työnkulku

Aloita escrow-pohjasta, hyväksyntäkierrosta tai tyhjästä projektista. Lisää
nimettyjä tiloja, valitse yksi alkutila ja merkitse valmiit tilat lopputiloiksi.
Tilojen sijainnit muuttavat vain kaavion asettelua. Kukin toiminto yhdistää
lähtötilan kohdetilaan; näiden muuttaminen muuttaa tuotetun sopimuksen toimintaa.

Projektissa voi olla enintään 8 roolia, 24 tilaa, 48 toimintoa ja 8 ehtoa kutakin
toimintoa kohden. Keskeneräisen, tyypeiltään kelvollisen luonnoksen voi tallentaa.
Lähdekoodin luominen vaatii kelvolliset viittaukset, yhden alkutilan, vähintään
yhden toiminnon ja saavutettavat tilat.

Toiminnolla on nimi, sallittu kutsuja, suoritettava toimenpide ja valinnaiset
ehdot. Roolilla on nimi ja Nodus EVM -osoite: `0x` ja 64 heksadesimaalimerkkiä.
Natiivi Nodus-sormenjälki on eri tunniste. Roolien osoitteiden pitää olla eri
osoitteita ja nollasta poikkeavia. Täytä oikeat osoitteet ennen lähdekoodin
luomista tai varsinaisen sopimuksen simulointia.

| Toimenpide | Suoritettava toiminta |
| --- | --- |
| Siirry tilaan | Vaihtaa työnkulun tilan vastaanottamatta tai lähettämättä varoja. |
| Talleta | Vastaanottaa täsmälleen määritetyn NODUS-määrän ja vaihtaa tilan. |
| Maksa | Lähettää määritetyn summan valitulle roolille ja vaihtaa tilan. |
| Hyväksy | Kirjaa kutsuvan roolin hyväksynnän kerran ja vaihtaa tilan. |
| Kirjaa tiiviste | Tallentaa sallitun kutsujan antaman nollasta poikkeavan `bytes32`-tiivisteen ja vaihtaa tilan. |

Hyväksyntä ja tiivisteen kirjaaminen vaativat kutsujaksi tietyn roolin. Muiden
toimenpiteiden kutsumisen voi sallia myös kenelle tahansa. Lähtötila, kutsujan
oikeus, transaktion arvo ja maksuun riittävä saldo tarkistetaan aina.
Lopputilasta lähtevä toiminto ei ole kelvollinen.

Osamaksut voi määrittää erillisillä maksutoiminnoilla ja välitiloilla. Jokaisella
maksulla on oma tarkka summansa, ja se on erillinen transaktio. Editori ei toteuta
yhdellä transaktiolla tehtävää maksun jakoa usealle vastaanottajalle.

## Ehdot ja hyväksynnät

Ehtoryhmä voi vaatia kaikki ehdot (**JA**) tai vähintään yhden ehdon (**TAI**).
Tyhjä ehtoryhmä ei aseta ylimääräistä ehtoa.

| Ehto | Mitä tarkistetaan |
| --- | --- |
| Ennen määräaikaa | Suorittavan lohkon aikaleima on aidosti ennen UTC-määräaikaa. |
| Määräajalla tai sen jälkeen | Lohkon aikaleima on saavuttanut määräajan. |
| Saldo vähintään | Työnkulkuun kirjattu saldo ennen toimintoa on vähintään määritetty summa. |
| Rooli on hyväksynyt | Valittu rooli on kirjannut hyväksynnän. |
| Hyväksyntöjä vähintään | Vähintään määritetty määrä eri rooleja on hyväksynyt. |
| Tiiviste vastaa arvoa | Tallennettu tiiviste vastaa määritettyä `bytes32`-arvoa. |

JA/TAI yhdistää vain näitä ehtoja. TAI-ryhmä ei ohita kutsujan oikeutta,
talletuksen tarkkaa arvoa, ylimääräisen arvon hylkäämistä tai maksun vaatimaa
saldoa. NODUS-määrissä on enintään kahdeksan desimaalia. Muunnos 18 desimaalin
EVM-wei-yksiköihin tehdään kokonaisluvuilla.

Ehdot lukevat tilanteen ennen toiminnon muutoksia: talletus ei vielä sisälly
sen omaan saldoehtoon, eikä hyväksyntää tai uutta tiivistettä ole vielä kirjattu.
Tarkista uudet arvot seuraavassa toiminnossa. Työnkulun kirjattu saldo sisältää
vain hyväksytyt talletukset. Ylimääräisiä tai pakotettuja EVM-varoja ei kirjata
työnkulun saldoksi.

Sopimuksessa on yksi yhteinen hyväksyntäkierros. Kukin rooli voi hyväksyä vain
kerran, ja hyväksyntä säilyy työnkulun tilan vaihtuessa. Tilakohtaisia kierroksia
tai hyväksyntöjen nollausta ei ole. Jos tarvitaan tiettyjen tarkastajien
hyväksyntä, käytä heidän roolikohtaisia ehtojaan; pelkkä hyväksyntöjen määrä
laskee kaikki onnistuneesti hyväksyneet roolit.

Tallennettu tiiviste on sallitun roolin kirjaama väite. Se ei todista asiakirjan
sisältöä, toimitusta, omistajuutta tai aitoutta. Myös hyväksyntä todistaa vain,
että määritetty rooli kutsui hyväksyntätoimintoa, ei ulkopuolisen tapahtuman
totuutta. Ulkoiset oraakkelisyötteet eivät kuulu tähän editoriin.

Tiivisteen vastaavuusehto, jonka arvossa on 64 nollaa, tarkistaa alkuarvon
”tiivistettä ei ole kirjattu”. Tiivisteen kirjaaminen vaatii nollasta poikkeavan arvon.

Määräaika sallii tai hylkää kutsun transaktion suoritushetkellä. Se ei lähetä
transaktioita automaattisesti. Ketjun aika tulee vahvistetusta lohkosta,
ei selaimen kellosta.

## Tallenna, avaa ja muunna aiemmat projektit

Editori käyttää uutta `nodus-contract-studio/v2`-projektiskeemaa. Nykyiset
`nodus-contract-studio/v1`-escrow-tiedostot ja tallennukset säilyttävät aiemman
merkityksensä. Muunnos on erillinen toiminto, joka luo irrallisen v2-kopion.
Tallenna se uudella nimellä, jotta molemmat versiot säilyvät. Vanhan tiedoston
tuonti ei korvaa sen nimettyä v1-tallennusta huomaamatta.
Vanhan kaavion pitää sisältää vaaditut tilat ja yhteydet ennen muunnosta.
Korjaa keskeneräinen kaavio ensin alkuperäisessä escrow-editorissa. Osapuolten
tyhjät osoitteet tai muut keskeneräiset asetukset voivat säilyä tyhjinä muunnoksessa.

Nimettyjen projektien lista on yhteinen aiemman escrow-editorin kanssa, ja siinä
voi olla enintään 50 tallennusta samassa selaimessa, laitteessa ja verkko-osoitteessa.
Uutena tallentaminen luo oman kopion; muutosten tallentaminen päivittää avoimen
nimetyn projektin. Työluonnoksen automaattinen selaintallennus toimii erikseen.
Lataus, korvaus ja poisto pyytävät tarvittaessa vahvistuksen ja säilyttävät muut
nimetyt projektit. Virheellistä tai lukukelvotonta tallennusaineistoa ei korvata
huomaamatta.

Vie projekti tiedostoksi varmuuskopiointia tai toiseen selaimeen tai tietokoneeseen
siirtoa varten. Sivustotietojen tyhjentäminen voi poistaa selaintallennukset.
Projekti sisältää työnkulun, roolit, summat, ehdot ja asettelun. Se ei sisällä
julkaistun sopimuksen ketjutilaa tai simulaation suoritusta.

## Tutki lähdekoodia ja simuloi

Lähdekoodinäkymä esittää nykyisestä työnkulusta tuotetun Solidityn. Toimintojen
nimet yhdistetään numeroituihin funktioihin, kuten `action_0()`, ja vastaavuus
näkyy editorissa. Nimiä ei sijoiteta suoritettavaksi Solidityksi. Tiivisteen
kirjaamisen funktiolla on `bytes32`-argumentti. Muilla toiminnoilla ei ole
argumentteja, ja vain talletus vastaanottaa nollasta poikkeavan transaktioarvon.

Funktioiden numerointi seuraa järjestettyjä toimintotunnisteita. Toiminnon
lisääminen tai poistaminen voi siksi muuttaa uuden lähdekoodin numerointia.
Säilytä kukin lähdekoodivienti ja sen toimintovastaavuudet yhdessä. Käytä
julkaistun version kanssa juuri kyseisestä lähdekoodista käännettyä ABI:a.
Lähdekoodinäkymä ja vientimanifesti näyttävät myös numeeristen tilalukujen ja
`role_N`-vakioiden vastaavuudet projektin tiloihin ja rooleihin.

Simulaattori käyttää määritettyjä tiloja, rooleja, toimenpiteitä ja ehtoja.
Valitse kutsuja, suorita toiminto, siirrä aikaa ja tutki saldoja, hyväksyntöjä
sekä tallennettua tiivistettä. Hylätty toiminto tai epäonnistuva maksu säilyttää
simulaation tilan, saldot, hyväksynnät, tiivisteen ja kellon ennallaan.
Sopimuksen lataus tai muokkaus tyhjentää aiemman simulaation.

Simulaatio on paikallinen JavaScript-malli, ei käännetyn Nodus-bytecoden suoritus
tai auditointi. Se ei mallinna kaasua, transaktiojärjestystä, mielivaltaisia
vihamielisiä takaisinkutsuja, pakotettuja EVM-saldoja, ketjun uudelleenjärjestelyjä
tai natiivi/EVM-siltaa. Tuotettu lähdekoodi pitää tarkistaa ja testata erikseen
ennen käyttöä.

## Käännä lähdekoodi ja ota se käyttöön

Lataa `ObservatoryWorkflow.sol`. Käytä [käännösohjeessa](contract-studio_fin.md#käännä-paikallisesti-nodus-solcilla)
nimettyä Nodus address256 -kääntäjää:

```bash
python3 tools/contract-studio/compile.py /path/to/ObservatoryWorkflow.sol \
  --contract ObservatoryWorkflow \
  --solc /path/to/solc-nodus \
  --project /path/to/project.json \
  --out /path/to/new-compiled-workflow
```

Konstruktorilla ei ole argumentteja. Roolien osoitteet, summat, ehdot ja määräaika
kiinnitetään itsenäiseen lähdekoodiin. Siinä ei ole tuonteja tai linkitettyjä
kirjastoja. Tavallinen Ethereum-solc tai 20 tavun osoitteille tehty työkaluketju
ei korvaa Noduksen kääntäjää ja lompakkoa. Selain ei tuota ABI:a tai bytecodea.

Tuotettu sopimus tarkistaa ehdot ennen muutoksia, vaihtaa tilan ennen ulospäin
lähteviä maksuja ja estää uudelleenkutsun. Epäonnistuva maksu peruu transaktion.
Nämä suojaukset eivät tee mielivaltaisesta käyttäjän suunnittelemasta
työnkulusta auditoitua escrow-palvelua.

Nykyinen suoritettava palettivalikoima ei sisällä toisten sopimusten kutsuja,
mielivaltaista Soliditya, ulkoista oraakkelitietoa, sopimuspäivityksiä tai
automaattista transaktioiden ajastusta. Kielen laajennus vaatii vastaavat
muutokset tarkistuksiin, generaattoriin, simulaattoriin ja testeihin.
