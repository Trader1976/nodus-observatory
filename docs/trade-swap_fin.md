# Trade / Swap — NODUS–BNB-testiverkkotyöpöytä

Yläreunan **Kaupankäynti** avaa uuden `#trade`-alueen. Ensimmäisessä versiossa voi
valmistella osto- ja myyntitarjouksia, tallentaa ne selaimeen, jakaa julkisen
JSON-tarjouksen, säilyttää salaisuuden erillisessä palautustiedostossa ja kokeilla
vaihtoa tai palautuksia. Sopimusten lähdekoodit, ABI:t ja käännetty bytecode ovat
ladattavissa. Näkymä toimii myös ilman seurantapalvelimen yhteyttä.

Tämä versio on valmistelu- ja testityökalu. Lompakoiden yhdistäminen, yhteinen
verkossa julkaistu tarjouskirja ja oikeiden tapahtumien lähettäminen eivät vielä
kuulu siihen. Simulaatio ei tarkista kummankaan ketjun talletuksia. Julkinen tarjous
on allekirjoittamaton ehdotus. Sopimukset voi julkaista erikseen testiverkkoihin.

## Kaupan tekemisen malli

**Myy NODUS:** tarjouksen tekijä lukitsee NODUSit ensin. Vastapuoli lukitsee tBNB:t.
Tekijä lunastaa tBNB:t salaisuudella, jonka vastapuoli saa tästä tapahtumasta ja
lunastaa sillä NODUSit.

**Osta NODUS:** tekijä lukitsee tBNB:t ensin. Vastapuoli lukitsee NODUSit. Tekijä
lunastaa NODUSit ensin ja vastapuoli tämän jälkeen tBNB:t samalla salaisuudella.

Molempien osapuolten molemmat osoitteet ja summat sovitaan ennen talletuksia.
Tekijän palautusraja on 24 tuntia tarjouksen luonnista ja vastapuolen 12 tuntia.
Ne eivät ala talletushetkestä. Määräajat näytetään UTC-ajassa. Vanhentunutta tarjousta
pitää uusia. Nämä ovat testikäytön oletukset.

## Kokeile käyttöliittymää

1. Valitse **Luo esimerkkikauppa**. Esimerkissä on kuvitteelliset osoitteet.
2. Valitse **Testaa kauppa → Aloita simulaatio**.
3. Lukitse ensin tekijän, sitten vastapuolen varat.
4. Kokeile väärää salaisuutta: siirtoa ei tapahdu.
5. Lunasta ensin tekijänä, sitten vastapuolena.
6. Aloita alusta ja kokeile määräaikoihin siirtymistä ja palautuksia.

Oman testisopimuksen valmisteluun avaa **Uusi tarjous**, anna nimi, suunta, summat
ja neljä oikeaa testiverkon osoitetta. Nodus EVM -osoite on `0x` + 64 heksamerkkiä,
BNB-osoite `0x` + 40. Tavallinen Noduksen 128 merkin sormenjälki ei ole EVM-osoite.
BNB-puoli on BNB Smart Chainin testiverkon oma tBNB, ketjutunnus 97.

## Julkinen tarjous ja yksityinen palautustiedosto

**Vie julkinen tarjous** on tiedosto vastapuolelle. Siinä on ehdot ja salaisuuden
tiiviiste, ei salaisuutta. Selaimeen tallentuu korkeintaan 50 julkista tarjousta.
Jos tallennus ei onnistu, vie tiedostot itse; virheellinen vanha tallennus säilytetään.

**Vie yksityinen palautustiedosto** sisältää myös salaisuuden. Säilytä se itselläsi
ennen sivun sulkemista. Älä lähetä sitä vastapuolelle. Salaisuutta ei tallenneta
selaimen pysyvään tallennukseen: sivun uudelleenlatauksen jälkeen sen voi palauttaa
vain tuomalla yksityisen tiedoston. Julkisen tarjouksen tuominen ei palauta sitä.
Salaisuus luodaan selaimen kryptografisella satunnaislukugeneraattorilla; SHA-256
lasketaan 32 raakabittitavusta, ei heksatekstistä.

## Oikean testiverkkokaupan edellytykset

Sopimus hyväksyy vain nimetyn testiverkon. BNB-mainnetin tunnus 56 hylätään.
Noduksen testiverkon tunnus on kiinnitetty nykyiseen viralliseen lompakkoversioon.
Molemmat sopimukset käyttävät samaa salaisuusmenetelmää mutta omia osoite- ja
summasääntöjään. Sama julkaistu sopimus voi käsitellä monta erillistä kauppaa.

Ennen salaisuuden paljastamista pitää todentaa **molempien verkkojen vahvistetut
lukitukset**: verkko, julkaistu koodi, tunniste, osapuolet, tarkat summat, tiiviste,
määräajat ja lukittu tila. Tulevan verkkoliitännän pitää tehdä nämä tarkistukset;
nykyisen simulaation tulos ei korvaa niitä. Kauppaa seurataan loppuun asti.
Palautus edellyttää omaa tapahtumaa määräajan jälkeen, eikä ketjun kello suorita
sitä itsestään. Verkkomaksut maksetaan kauppasummien lisäksi.

Koko kehittäjäohje, sopimusrajapinnat, lähdeversiot ja toistettavat testit:
[trade-swap.md](trade-swap.md). Sopimusten suoritusta testataan erikseen paikallisessa
EVM:ssä ja Noduksen omassa 32 tavun moottorissa. Testit eivät ole ulkoinen auditointi
eivätkä vielä osoita kahden oikean testiverkon ja lompakoiden yhteistoimintaa.
