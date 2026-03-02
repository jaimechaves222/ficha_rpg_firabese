<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyAh4xwGI7hVn4yvjKYoDzgLAayMpXcxiRQ",
    authDomain: "ficha-36ff7.firebaseapp.com",
    projectId: "ficha-36ff7",
    storageBucket: "ficha-36ff7.firebasestorage.app",
    messagingSenderId: "786365787379",
    appId: "1:786365787379:web:7b2813f7519aae903b1b86",
    measurementId: "G-4FQ1Z9V5FT"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
