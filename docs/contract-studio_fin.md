# Sopimusstudio — kokeellinen haara

[English](contract-studio.md) · **Suomi**

Sopimusstudio on kokeilu haarassa `feature/contract-studio`. Sitä ei ole liitetty
`main`-haaraan. Selainpohjaisella editorilla voi rakentaa yhden rajatun
escrow-sopimuspohjan, kokeilla sen tilamallia ja viedä projektin sekä
toistettavasti tuotetun Solidity-lähdekoodin. Seurantapalvelin säilyy vain
lukevana: sille ei lisätä transaktio-, allekirjoitus-, käännös- tai
avaintenhallintarajapintaa.

## Rakenna ja tarkista escrow

Avaa sivuvalikosta **Sopimusstudio** ja valitse **Escrow-esimerkki**.
[Asiakirjarekisteri](document-notary_fin.md) on oletustyötila. Aiemmat escrow-luonnokset
säilyvät samassa selaimessa. Paletin painike näyttää jo kaaviossa olevan palikan
luomatta kaksoiskappaletta. Poistetun palikan voi palauttaa **Lisää**-painikkeella.
Anna ostajan ja myyjän **Nodus EVM
-osoitteet**, NODUS-määrä ja tarkka määräaika. Uuden luonnoksen tyhjät osoitteet
on täytettävä ennen lähdekoodin vientiä tai oman sopimuksen simulointia.
Simulaattorin erillinen esimerkkitila käyttää julkisia mallitunnisteita
muuttamatta varsinaista sopimusta. Studio vaatii EVM-osoitteelle `0x`-alkuliitteen
ja sen jälkeen 64 heksadesimaalimerkkiä. Natiivi 128-merkkinen
Nodus-sormenjälki on eri tunniste, eikä sitä hyväksytä EVM-osoitteeksi.

Kaaviossa on tiloja ja suunnattuja yhteyksiä. Siirrä tiloja raahaamalla ja lisää
tai poista kaavion osia tilojen ja yhteyksien painikkeilla. Raahaaminen muuttaa
asettelua, ei sopimuksen maksusääntöjä. Editori vertaa kaaviota tämän ensimmäisen
pohjan rakenteeseen. Puuttuvat, toistuvat tai tukemattomat tilat ja yhteydet
estävät lähdekoodin viennin sen sijaan, että niiden merkitys vaihdettaisiin
huomaamatta. Samoja toimintoja voi käyttää myös ilman raahaamista.

| Toiminto | Kuka kutsuu | Vaadittu tila ja aika | Tulos |
| --- | --- | --- | --- |
| `deposit()` | Ostaja | Created; ennen määräaikaa; täsmällinen summa | Funded |
| `approve()` | Ostaja | Funded; ennen määräaikaa | Approved |
| `withdraw()` | Myyjä | Approved; myös määräajan jälkeen | Sovittu summa myyjälle; Paid |
| `refund()` | Ostaja | Funded; määräajalla tai sen jälkeen | Sovittu summa takaisin ostajalle; Refunded |
| `cancel()` | Ostaja | Created | Cancelled |

Hyväksyntä sitoo maksun: hyväksyttyä sopimusta ei voi palauttaa määräajan
umpeuduttua. Mukana ei ole ulkopuolista sovittelijaa eikä toimitusta tarkistavaa
oraakkelia. Määräaika tarkistetaan transaktion suorituksen yhteydessä. Se ei
ajasta eikä lähetä transaktiota automaattisesti. Ketjun aika on vahvistetun
lohkon Unix-aikaleima, ei selaimen kello.

Summassa sallitaan enintään kahdeksan desimaalia, kuten natiivin NODUSin
siirtosillassa. Muunnos tehdään täsmällisesti kokonaisluvuilla: natiivit
raakayksiköt × 10^10 = EVM-wei. Yksi NODUS on 10^8 natiivia raakayksikköä tai
10^18 EVM-wei. Tuotettuun Solidityyn ei sijoiteta liukulukumääriä. Ostaja,
myyjä, summa ja määräaika ovat lähdekoodiin kiinnitettyjä vakioita.
Konstruktorilla ei ole argumentteja. Lähdekoodi on itsenäinen eikä käytä
tuonteja tai ulkoisesti linkitettyjä kirjastoja.

### Simulointi ja luonnokset

Valitse rooli, kokeile toimintoa ja siirrä simuloitua aikaa eteenpäin. Malli
tarkistaa väärän kutsujan, toimintojen järjestyksen, täsmällisen talletuksen,
määräajan rajakohdan, toistuvan maksun ja vastaanottajan epäonnistuvan maksun.
Hylätty toiminto ei muuta mallin tilaa eikä saldoja. Solidity tarkistaa ehdot
ennen muutoksia, muuttaa tilan ennen ulospäin lähtevää maksua ja käyttää
uudelleenkutsun estävää lukkoa. Epäonnistuva maksu peruu transaktion muutokset.

Simulaattori on tarkoitettujen sääntöjen JavaScript-malli. **Se ei suorita
käännettyä bytecodea**, simuloi verkkoa eikä ole auditointi. Se ei mallinna
kaasunkulutusta, lohkon transaktiojärjestystä, mielivaltaisia vihamielisiä
vastaanottajasopimuksia, ketjun uudelleenjärjestelyjä eikä natiivi/EVM-siltaa.
Tuodut projektit ovat dataa: editori tarkistaa niiden skeeman ja kaavion eikä
suorita tuotua koodia. Luonnokset tallentuvat tähän selaimeen. Siirrä projekti
toiseen selaimeen vienti- ja tuontitoiminnoilla.

### Nimettyjen projektien tallennus ja lataus

**Tallennetut projektit** säilyttää enintään 50 nimettyä projektia tämän laitteen
samassa selaimessa ja samassa verkko-osoitteessa. Anna **Projektin nimi** ja valitse
**Tallenna uutena projektina**. Valitse myöhemmin projekti nimen ja viimeisimmän
tallennusajan sisältävästä listasta ja paina **Lataa projekti**. Lataus palauttaa
ehdot, tarkat summat, palikoiden sijainnit ja yhteydet. Myös keskeneräisen
kaavion tai tyhjät osoitteet voi tallentaa; virheelliset kentät tai tukemattomat
yhteydet pitää korjata ensin. Simulaation suoritustilaa ei tallenneta projektiin,
ja lataus tyhjentää edellisen simulaation.

**Tallenna muutokset** päivittää avoimen nimetyn projektin. Toisen nimen käyttö
ja **Tallenna uutena projektina** luo erillisen kopion. Sama nimi ei korvaa
aiempaa tallennusta. Pelkkä ehtojen tai kaavion muokkaus ei päivitä nimettyä
kopiota: selaimen yhden työluonnoksen automaattitallennus toimii erikseen.
Sivun uudelleenavaus palauttaa työluonnoksen; valitse nimetty projekti listasta,
kun haluat jatkaa sen tallennetun kopion muokkausta.

Jos avoimeen luonnokseen on tehty muutoksia, lataus kysyy ennen niiden
korvaamista. Nollaus ja tiedoston tuonti eivät muuta nimettyjä tallennuksia.
**Poista tallennettu projekti** kysyy vahvistuksen ja säilyttää avoimen
luonnoksen. Toisessa välilehdessä muuttunutta projektia ei korvata vanhalla
versiolla: lataa se uudelleen tai tallenna työsi uutena projektina.
Tallennusvirheestä näytetään ilmoitus, ja edellinen tallennus säilytetään.
Lukukelvotonta tallennuslistaa ei korvata automaattisesti.

Nimetyt projektit eivät siirry palvelimelle eivätkä toiseen selaimeen tai
laitteeseen. Selaimen sivustotietojen tyhjennys voi poistaa ne. Käytä
**Vie projekti**- ja **Tuo projekti** -toimintoja siirtoon ja varmuuskopiointiin;
ne toimivat myös ilman selaintallennusta. Projektitiedosto on aiempi yhteensopiva
`nodus-contract-studio/v1`-kaavio ilman tallennuslistan nimeä ja aikaleimoja.
Se sisältää sopimusehdot ja kaavion, ei julkaistun sopimuksen ketjutilaa.

Tuotettu sopimus hylkää tavalliset ylimääräiset maksut. EVM voi silti pakottaa
osoitteelle saldoa `SELFDESTRUCT`-toiminnolla kutsumatta vastaanottofunktiota.
Escrow maksaa täsmälleen sovitun summan, eikä siinä ole ylimääräisen saldon
palautustoimintoa. Sopimuksen koko EVM-saldoa ei siis pidä tulkita
jommallekummalle osapuolelle kuuluvaksi lisämaksuksi.

## Käännä paikallisesti Nodus solcilla

Selain vie **Solidity-lähdekoodin**, ei keksittyä ABI:a tai bytecodea. Hanki
kääntäjä erikseen ja anna sen polku nimenomaisesti
[paikalliselle käännöstyökalulle](../tools/contract-studio/compile.py). Työkalu ei
lataa tai asenna suoritettavia tiedostoja eikä lue identiteettihakemistoa.

Tuettu kääntäjä on Solidity **0.8.30 Noduksen address256-muutoksella**, versio
`0.8.30+nodus.addr256.commit.73712a01`. Tavallinen Ethereum-solc hylätään:
se käsittelee osoitteet 20-tavuisina ja voi huomaamatta kohdistaa kutsun
eri tilille.

Noduksen virallinen Linux x86-64 -paketti:

- [nodus-solc-0.8.30-nodus.addr256-linux-x86_64.tar.gz](https://nodusnetwork.io/downloads/nodus-solc-0.8.30-nodus.addr256-linux-x86_64.tar.gz)
- Paketin SHA-256: `a09d6486c944a795009f08dbc8210ce2eee2785248f9f5f7edc2aaa9c6934649`
- Dokumentoitu kääntäjäbinäärin SHA-256: `6c981f36ee790a46fa2310c4eb925e35909b020a58a19654a063517947ceffb4`

Tunnisteet on tarkistettu alla nimetystä Noduksen lähdekoodiversiosta.
Tarkista Noduksen ajantasaiset ohjeet ennen muun version valitsemista.
Dokumentoitu binääri tarvitsee vähintään glibc 2.34:n sekä libstdc++:n, jossa
on `GLIBCXX_3.4.29`. MetaMask, ethers, viem ja tavallinen Solidity-työkaluketju
eivät korvaa Noduksen omia työkaluja.

Lataa paketti ja tarkista sen tiiviste erikseen. Pura se työhakemistoon ja
tarkista `solc-nodus --version`. Käännöstyökalu ei tarvitse järjestelmänlaajuista
asennusta eikä `sudoa`. Aja Observatoryn lähdekoodihakemistossa:

```bash
python3 tools/contract-studio/compile.py /path/to/ObservatoryEscrow.sol \
  --solc /path/to/solc-nodus \
  --project /path/to/project.json \
  --out /path/to/new-compiled-escrow
```

`--project` on valinnainen. Olemassa olevaa tuloshakemistoa ei korvata.
Käännös käyttää Standard JSON -muotoa, nimenomaisia Prague-sääntöjä,
optimointia 200 suoritukselle ja bytecodea ilman metadatan tiivistettä.
Tuonnit ja kääntäjän tiedostojärjestelmää lukeva tuontitoiminto on estetty.
Työkalu tarkistaa diagnostiikan, metadatan kääntäjätunnisteen,
konstruktoriargumentit, ratkaisemattomat kirjastot sekä bytecoden koon ja
heksadesimaalimuodon ennen tulosten tallentamista. Syötetiedoston enimmäiskoko
on 1 MiB. Kääntäjän oletusaikaraja on 60 sekuntia kutsua kohden, ja hyväksyttävän
tulosteen enimmäiskoko 16 MiB.

| Tiedosto | Tarkoitus |
| --- | --- |
| `ObservatoryEscrow.sol` | Täsmälleen käännetyt lähdekooditavut |
| `ObservatoryEscrow.abi.json` | Kääntäjän tuottama funktio-, tapahtuma- ja virherajapinta |
| `ObservatoryEscrow.creation.hex` | `0x`-alkuinen julkaisuun käytettävä bytecode |
| `ObservatoryEscrow.runtime.hex` | Suorituskoodin vertailutieto; **ei** julkaisun syöte |
| `ObservatoryEscrow.metadata.json` | Kääntäjän metadata ja Nodus-versiotunniste |
| `ObservatoryEscrow.storage-layout.json` | Kääntäjän ilmoittama tallennusrakenne |
| `compiler-input.json`, `compiler-diagnostics.json` | Toistettavat asetukset ja diagnostiikka |
| `project.json` | Valinnainen, muuttamaton projektin arkistokopio |
| `manifest.json` | SHA-256-tiivisteet, kääntäjätunniste, koot ja alkuperätiedot |

Manifesti tallentaa lähdekoodin ja projektin tiivisteet erikseen. Niiden
vastaavuudeksi merkitään nimenomaisesti **not_verified**: Python-työkalu kääntää
saamansa lähdekoodin. Se ei toteuta selaimen generaattoria uudelleen eikä väitä,
että mikä tahansa mukana arkistoitu projekti kuvaisi kyseistä lähdekoodia.
Kääntäjän versioteksti tarkistetaan ja käytetyn ohjelman SHA-256 kirjataan.
Manifesti ilmoittaa myös, vastaako tiiviste dokumentoitua virallista binääriä.
Pelkkä oikea versioteksti ei todista mielivaltaisen ohjelmatiedoston aitoutta.

## Siirto lompakkoon

Tarkista ensin lähdekoodi ja siihen sijoitetut vakiot. Liitä Nodus-lompakon
älysopimusnäkymässä `ObservatoryEscrow.abi.json` **ABI**-kenttään ja
`ObservatoryEscrow.creation.hex` **Bytecode**-kenttään. Valitse **Deploy**.
Konstruktorin argumentit ovat tyhjät ja julkaisun arvon tulee olla nolla.
Lompakko näyttää tarkistusnäkymän ja allekirjoittaa transaktion. Observatory ei
tee kumpaakaan. Kirjaa syntyneen sopimuksen osoite ja säilytä lähdekoodi, ABI
ja manifesti yhdessä.

Avaa julkaistu osoite samalla ABI:lla. Ostaja tarvitsee talletukseen EVM-saldoa,
jota siirretään lompakon erillisellä **Deposit**-siltatoiminnolla. Sen jälkeen
hän kutsuu sopimuksen `deposit()`-funktiota täsmälleen sovitulla NODUS-arvolla.
Hyväksyntään, myyjän nostoon, palautukseen ja peruutukseen ei liitetä arvoa.
Jokainen kutsuja tarvitsee myös natiiveja kolikoita verkkopalkkioihin.
Nykyisillä Nodus-säännöillä lohkoon sisällytetty, peruva EVM-kutsu maksaa silti
verkkopalkkion.

Sopimuksen `withdraw()` maksaa myyjän **EVM-tilille**. Se ei sellaisenaan tuota
lompakkoon natiivina käytettäviä kolikoita. Arvon siirto EVM-tililtä takaisin
natiiviksi NODUSiksi on lompakon erillinen **Withdraw**-siltatoiminto.
Sopimuksen nosto ja siltanosto ovat siis kaksi eri toimenpidettä.

Kokeilun toteutuksessa ei ole julkaistu sopimusta, allekirjoitettu eikä
lähetetty transaktioita. Käytä viennin arviointiin virallisen lompakon omaa
transaktion tarkistusnäkymää ja testnetiä. Tämä pohja ei ole auditoitu
escrow-palvelu.

## Tarkistukset ja nykyiset rajat

Haarassa on testejä kaaviolle, skeemalle, generaattorille, simulaattorille ja
käännöstyökalun rajoille. Valinnaisen oikeaa kääntäjää käyttävän tarkistuksen
voi käynnistää näin:

```bash
NODUS_STUDIO_SOLC=/path/to/solc-nodus \
  python3 -m unittest discover -s tests -p test_contract_studio_compile.py -v
```

Toteutuksen aikana virallisen paketin ja binäärin yllä mainitut tiivisteet
tarkistettiin. Sopimusgeneraattorin oikeasti tuottama escrow käännettiin tällä
binäärillä ilman kääntäjädiagnostiikkaa. Valinnainen integraatiotesti tarkistaa
tulosten toistettavuuden ja kääntäjän 32-tavuisen osoitteen tallennusrakenteen.
Nämä tarkistukset eivät todista simulaattorin ja Nodus-moottorin suorituksen
vastaavuutta. Käännetyn escrow'n suorittamista paikallisella EVM:llä tai
elävässä ketjussa ei ole väitetty testatuksi.

Ensimmäinen pohja ei tue osamaksuja, useita kauppoja, sovittelua,
automaattisia ajastimia, päivityksiä, mielivaltaisia Solidity-tuonteja,
ulkoisia oraakkeleita, linkitettyjä kirjastoja, omia suorituspalikoita,
sopimuksen julkaisua Observatorysta eikä sopimustransaktioiden seurantaa.
Asettelun muokkaus on tuettu. Sopimuspohjan merkityksen laajennus edellyttää
skeeman, generaattorin, simulaattorin ja testien yhteistä muutosta.

## Noduksen lähdekoodiviitteet

Tutkimus on kiinnitetty `nocdem/dna`-versioon
`908f76102ac3ded448f2c87ac72772e0c02642c0` (tarkistettu 19.10.2026):

- [Noduksen Solidity-kääntäjä ja 32-tavuiset osoitteet](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/evm/solc/README.md)
- [Virallinen kääntäjälataus, EVM-yksiköt ja lompakko/CLI-työnkulku](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/website/wiki/developers.html)
- [Itsenäinen token-esimerkki ja käännöstyönkulku](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/evm/examples/README.md)
- [Lompakon ABI/bytecode-kentät ja julkaisulomake](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/ui.js)
- [Lompakon transaktioiden muodostus ja natiivi/EVM-silta](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/contract.js)
- [Noden EVM-asetukset ja vahvistetun lohkon aikaleima](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/src/witness/nodus_witness_rt_evm.c)
- [Praguen SELFDESTRUCT-toiminta](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/shared/evm/evm_interp.c)
