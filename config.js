/* ====== KONFIGURACE — Deník staveb Rekonstrukce Vrána ======
   Vyplní se při nasazení (Firebase console → Project settings → Web app).
   scriptUrl = URL nasazeného Apps Scriptu (most na Google Drive).       */
window.VRANA_CONFIG = {
  firebase: {
    apiKey: "AIzaSyB9bSVxEovPsOehpXvn5BfK1F-GLGwP3W0",
    authDomain: "vrana-denik.firebaseapp.com",
    projectId: "vrana-denik",
    storageBucket: "vrana-denik.firebasestorage.app",
    messagingSenderId: "117132073301",
    appId: "1:117132073301:web:29d6f74c37a5794154f7dc"
  },
  scriptUrl: "https://script.google.com/macros/s/AKfycbzjhJOLVnwi0uVND23NDSK9VS_h-Y4zRPzfKbPN5BB5xnK6rwQYC8-6BlpPgHTr1nFTwg/exec",
  driveRootFolderId: "1rROjwK7T-XCwKjYDfDN9fDa8HjJuryyZ", // 01_Aktivni_zakazky na Sdíleném disku
  firmName: "Rekonstrukce Vrána s.r.o.",
  firmContact: "702 111 001 · info@rekovrana.cz",
  gpsTolerance: 100         // povolená odchylka check-inu v metrech (výchozí)
};
