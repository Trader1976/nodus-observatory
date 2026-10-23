(() => {
  'use strict';
  const messages={
    'TESTNET WORKBENCH':'TESTIVERKKOTYÖPÖYTÄ','Prepare a NODUS / BNB swap':'Valmistele NODUS / BNB -kauppa',
    'Create buy and sell offers, rehearse both chain legs, and export the actual contracts.':'Luo osto- ja myyntitarjouksia, kokeile molemmat siirrot ja vie sopimukset testiverkkoihin.',
    'Local preparation and simulation. Wallet connections, a shared order book and network transactions are not included in this version.':'Paikallinen valmistelu ja simulaatio. Tämä versio ei vielä yhdistä lompakoita, julkaise yhteistä tarjouskirjaa tai lähetä verkkotapahtumia.',
    'Nodus testnet':'Nodus testnet','BNB Smart Chain testnet · 97':'BNB Smart Chain testnet · 97','Offers':'Tarjoukset','New offer':'Uusi tarjous','My offers':'Omat tarjoukset',
    'Offers stay in this browser. Share a public offer file with the other party.':'Tarjoukset tallentuvat tähän selaimeen. Jaa julkinen tarjoustiedosto vastapuolelle.',
    'Name':'Nimi','Direction':'Suunta','Sell NODUS':'Myy NODUS','Buy NODUS':'Osta NODUS','NODUS amount':'NODUS-määrä','tBNB amount':'tBNB-määrä',
    'Maker':'Tarjouksen tekijä','Taker':'Vastapuoli','Nodus EVM address (32 bytes)':'Nodus EVM -osoite (32 tavua)','BNB address (20 bytes)':'BNB-osoite (20 tavua)',
    'Both parties and both receiving addresses are fixed before either deposit.':'Molemmat osapuolet ja vastaanotto-osoitteet sovitaan ennen talletuksia.',
    'Create offer':'Luo tarjous','Import offer / recovery':'Tuo tarjous / palautustiedosto','Create example':'Luo esimerkkikauppa','No offers yet.':'Ei vielä tarjouksia.',
    'Example swap':'Esimerkkikauppa','Name / direction':'Nimi / suunta','Amounts':'Määrät','Open':'Avaa','Delete':'Poista','Delete this offer?':'Poistetaanko tämä tarjous?',
    'Keep':'Säilytä','Confirm deletion':'Vahvista poisto','Offer details':'Tarjouksen tiedot','Rehearse swap':'Testaa kauppa','Contracts':'Sopimukset','Choose an offer to continue.':'Valitse tarjous jatkaaksesi.',
    'Export public offer':'Vie julkinen tarjous','Export private recovery':'Vie yksityinen palautustiedosto','Export transaction plan':'Vie tapahtumasuunnitelma',
    'The recovery file contains the secret. Keep it private; it is not included in public offers or browser storage.':'Palautustiedosto sisältää salaisuuden. Säilytä se yksityisenä. Salaisuutta ei sisällytetä julkiseen tarjoukseen tai selaintallennukseen.',
    'The secret is available only in this session. Export the recovery file before closing.':'Salaisuus on käytettävissä vain tässä istunnossa. Vie palautustiedosto ennen sulkemista.',
    'Import the private recovery file to restore the maker secret.':'Tuo yksityinen palautustiedosto palauttaaksesi tekijän salaisuuden.',
    'Maker refund':'Tekijän palautusraja','Taker refund':'Vastapuolen palautusraja','Hashlock':'Salaisuuden tiiviste','Trade ID':'Kaupan tunniste',
    'Deadlines use UTC and start when the offer is created: 24 hours for the maker, 12 hours for the taker.':'Palautusrajat ovat UTC-ajassa ja alkavat tarjouksen luomisesta: tekijälle 24 tuntia, vastapuolelle 12 tuntia.',
    'Start simulation':'Aloita simulaatio','Reset simulation':'Aloita alusta','Simulation only':'Vain simulaatio','Simulated time':'Simuloitu aika',
    'Lock maker funds':'Lukitse tekijän varat','Lock taker funds':'Lukitse vastapuolen varat','Maker claims':'Tekijä lunastaa','Taker claims':'Vastapuoli lunastaa',
    'Advance to taker deadline':'Siirry vastapuolen määräaikaan','Advance to maker deadline':'Siirry tekijän määräaikaan','Refund maker':'Palauta tekijälle','Refund taker':'Palauta vastapuolelle',
    'Test a wrong secret':'Kokeile väärää salaisuutta','Empty':'Ei talletusta','Locked':'Lukittu','Claimed':'Lunastettu','Refunded':'Palautettu',
    'Secret not revealed':'Salaisuutta ei ole paljastettu','Secret revealed by first claim':'Ensimmäinen lunastus paljasti salaisuuden','Both legs settled.':'Molemmat siirrot toteutettu.',
    'The maker claims the shorter lock first. The taker then uses the revealed secret to claim the longer lock.':'Tekijä lunastaa ensin lyhyemmän lukituksen. Vastapuoli lunastaa pidemmän samalla paljastuneella salaisuudella.',
    'A simulation does not verify deposits on either network.':'Simulaatio ei todenna kummankaan verkon talletuksia.',
    'Download source':'Lataa lähdekoodi','Download ABI':'Lataa ABI','Download bytecode':'Lataa bytecode','Pinned compiler':'Kiinnitetty kääntäjä','Address size':'Osoitteen koko',
    'These are complete compiled contracts for the named testnets. Deployment and wallet execution are separate steps.':'Nämä ovat kokonaiset käännetyt sopimukset nimetyille testiverkoille. Julkaisu ja suoritus lompakossa ovat erillisiä vaiheita.',
    'Before the maker reveals the secret, independently verify the two confirmed locks: network, code, trade ID, parties, amounts, hash and deadlines.':'Ennen salaisuuden paljastamista tarkista molemmat vahvistetut lukitukset: verkko, koodi, tunniste, osapuolet, määrät, tiiviste ja määräajat.',
    'Each refund requires a transaction after its deadline. Network fees are separate from the trade amounts.':'Jokainen palautus tarvitsee tapahtuman määräajan jälkeen. Verkkokulut ovat erillisiä kauppasummista.',
    'Offer created. Export the private recovery file.':'Tarjous luotu. Vie yksityinen palautustiedosto.',
    'Imported.':'Tuotu.','Deleted.':'Poistettu.','Download created.':'Lataus luotu.','Simulation advanced.':'Simulaatio eteni.',
    'Storage is unavailable. Export the public offer and private recovery file.':'Tallennus ei ole käytettävissä. Vie julkinen tarjous ja yksityinen palautustiedosto.',
    'Stored offers could not be read. Existing data was retained.':'Tallennettuja tarjouksia ei voitu lukea. Aiempi aineisto säilytettiin.',
    'The offer list is full (50). Export and delete an older offer.':'Tarjouslista on täynnä (50). Vie ja poista vanhempi tarjous.',
    'The same trade ID already has different terms.':'Samalle kaupan tunnisteelle on jo tallennettu eri ehdot.',
    'Check the input: {code} ({field}).':'Tarkista tiedot: {code} ({field}).',
    invalid_schema:'virheellinen tiedostorakenne',invalid_hash:'virheellinen 32 tavun tiiviste',invalid_address:'virheellinen osoite',invalid_amount:'virheellinen summa tai desimaalitarkkuus',invalid_name:'anna nimi (1–80 merkkiä)',wrong_network:'väärä verkko',invalid_deadline:'virheellinen määräaika',unsafe_deadlines:'määräaikojen väli on liian lyhyt',file_too_large:'tiedosto on liian suuri',invalid_json:'virheellinen JSON',crypto_unavailable:'selaimen suojattu salaustoiminto ei ole käytettävissä',wrong_secret:'väärä salaisuus',offer_expired:'tarjouksen talletusaika on päättynyt',invalid_simulation:'virheellinen simulaatiotila',unauthorized:'väärä osapuoli',already_locked:'lukitus on jo olemassa',first_lock_required:'tekijän varat on lukittava ensin',not_locked:'varoja ei ole lukittu',claim_expired:'lunastusaika on päättynyt',secret_not_revealed:'salaisuutta ei ole paljastettu',payment_failed:'maksu epäonnistui',refund_not_ready:'palautuksen määräaika ei ole vielä täyttynyt',download_failed:'tiedostoa ei voitu ladata'
  };
  globalThis.NodusTradeText=(key,params={})=>{let text=globalThis.NodusI18n?.language?.()==='en'?key:(messages[key]??key);return text.replace(/\{(\w+)\}/g,(m,k)=>Object.hasOwn(params,k)?String(params[k]):m);};
  globalThis.NodusI18n?.addMessages({'Kaupankäynti':'Trade / Swap','Selaimessa valmisteltava NODUS / BNB -kauppa':'Browser-local NODUS / BNB swap preparation','TESTIVERKOT · PAIKALLINEN SIMULAATIO':'TESTNETS · LOCAL SIMULATION','Trade / Swap -tiedostot puuttuvat. Päivitä asennus.':'Trade / Swap assets are missing. Update the installation.'});
})();
