# Natiivin tUSDT:n sopimuskäytön selvitys

[English](NATIVE_ASSETS.md)

Tarkistettu 26.10.2026 virallisen lähdekoodin tuoreimmasta päähaaran versiosta
`nocdem/dna@d065cf3db719f990fe3777237af0f7166d5a5330`.

**Nykyiselle natiiville tUSDT:lle ei löytynyt tuettua rajapintaa tähän
EVM-lainasopimukseen.** Erikseen nimetty EVM-testitoken soveltuu ketjussa
tehtävään käyttöönoton kokeiluun. Kyse on eri omaisuuseristä.

## Mitä tarkistettiin

| Kohta | Havainto |
| --- | --- |
| tUSDT:n tunniste | Natiivi UTXO-token, 64 tavun token-ID ja kuusi desimaalia. Tunniste on `config.example.json`-tiedostossa, eikä se ole EVM-osoite. |
| Natiivin tokenin käyttöoikeus | Omistajan allekirjoitus tai täytetty M-of-N-ehto. EVM-sopimuksen tallennettu lainatila ei anna tätä käyttöoikeutta. |
| Natiivien siirtojen ehdot | Tavalliset siirtojen ulostulot ovat lukitsemattomia. Yleistä käyttäjän ohjelmoimaa HTLC-, covenant- tai lainaehdon rajapintaa ei löytynyt. Protokollan omat elinkaarilukot ovat eri asia. |
| EVM-talletus | Rahoitussyötteet hyväksytään vain natiivina NODUS-kolikkona. DEPOSIT sisältää määrän ja noncen, mutta ei token-ID:tä. |
| Atominen yhdistäminen | EVM-tapahtumassa on täsmälleen kaksi osaa: CORE EVMFUND ja vastaava EVM-operaatio. tUSDT-siirtoa ei voi vain liittää kolmanneksi osaksi. |
| EVM:n erikoisrajapinnat | Tavalliset esikäännetyt operaatiot, ML-DSA ja NODUS-nostolipukkeet löytyivät. Natiivin tokenin sopimussäilytystä tai tilitystä ei löytynyt. |
| Lompakon sopimusnäkymä | Tukee ABI:n ja tavukoodin julkaisua, konstruktorin argumentteja ja maksettavia sopimuskutsuja. Sitä voi käyttää erillisen EVM-testitokenin kokeiluun. |

Tämä on lähdekoodiin perustuva johtopäätös. Tuleva protokollamuutos voi muuttaa
tilannetta. Kahden omaisuuserän näkyminen samassa lompakossa ja ketjussa ei vielä
tarkoita, että EVM voi hallita molempien kirjanpitoa.

## Mahdolliset etenemistavat

1. **Erillinen EVM-testitoken:** `SandboxDollar6` (OSD6) ja sitä käyttävä
   `LendingReference`. [Käyttöönotto-ohje](DEPLOYMENT_fin.md) käyttää lompakon
   nykyistä sopimusnäkymää. Paketti sisältää aidon käännetyn tavukoodin, mutta ei
   väitettyjä ketjutapahtumien tuloksia. OSD6 ei ole tUSDT:n kääre eikä sillä ole
   USDT-katetta. Oikea testnet-koe on vielä tehtävä operaattorin lompakossa.
2. **Natiivi multisig-palvelu:** aitoa tUSDT:tä voi pitää M-of-N-hallinnassa,
   mutta siirrot tarvitsevat allekirjoittajat. Mukaan tulee luottamus,
   saatavuus ja riitojen ratkaisu; lainaehdot eivät toteudu itsenäisesti.
3. **Natiivien tokenien protokollatuki EVM:ään:** vaatii konsensuksen valvoman
   säilytys- ja tilitysrajapinnan, aktivoinnin sekä lompakkotuen. Observatoryn
   käyttöliittymämuutos ei yksin riitä.

ML-DSA-allekirjoitus maksua koskevassa väitteessä osoittaa allekirjoittajan.
Se ei yksin todista tUSDT-maksua eikä siirrä natiivien tokenien hallintaa EVM:lle.

## Kehittäjille ehdotettava kyvykkyys

Ehdotus on **konsensuksen valvoma natiivien omaisuuserien käyttö EVM-sopimuksissa**.
Yksi mahdollinen ratkaisu olisi kanoninen lukitus/luonti ja poltto/vapautus.
Arkkitehtuuri on sovittava protokollakehittäjien kanssa; olemassa olevaa siltaa,
osoitetta tai tällaista rajapintaa ei oleteta.

Vähimmäisvaatimuksia suunnitteluun:

- Sido verkko, token-ID, desimaalit ja EVM-esitys täsmällisesti. Pelkkä symboli
  ei riitä. Määritä tarjonnan rajat ja natiivin uint64-määrän käsittely.
- Natiivien syötteiden kulutus ja oikean EVM-vastaanottajan hyvitys tapahtuvat
  atomisesti. Kumpikaan puolisko ei saa onnistua yksin.
- EVM-esityksen poltto ja token-kohtainen vapautus ovat atomisia. Nostolipuke
  sitoo tokenin, määrän, vastaanottajan, verkon ja yksilöllisen tunnisteen.
  Saman lipukkeen lunastaminen uudelleen estetään.
- Molempien alueiden käyttöoikeudet tarkistetaan konsensuksessa. Operaattorin
  ilmoitus talletuksesta ei saa korvata sitä.
- Määritä metadata, tuntemattomat tokenit, kulut, pyöristys, virhetilanteet ja
  keskeneräisten tapahtumien selvitys niin, ettei varojen hallinta katoa.
- Aktivoi konsensusmuutos versioituna, lisää lompakko- ja SDK-kutsut sekä testaa
  väärennetyt tokenit, väärä verkko, kaksoiskäyttö ja osittaiset suoritukset.

Tämän jälkeen lainasivusto tarvitsee edelleen vahvistetun tarjouskirjan,
lompakkopyynnöt, tapahtumien tilanseurannan ja lopullisen vakuusriskin mallin.
Nykyinen koko vakuuden luovutus maksulaiminlyönnissä on kokeellinen testisääntö.

## Lähteet

Tarkat tiedostot, funktiot ja samaan tarkistettuun versioon lukitut linkit ovat
[englanninkielisen selvityksen lähdetaulukossa](NATIVE_ASSETS.md).
