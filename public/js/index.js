

// REDIRECT TO PROFILE
function redirectToProfile(username) {
  document.getElementById('loading-overlay').style.display = 'flex';
  setTimeout(function() {
    window.location.href = `/user/profile/${username}`;
  }, 750);  // 100ms delay so the overlay appears
 
}

// INSTALL PROMPT HANDLING
let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // Prevent the default mini-infobar
  deferredPrompt = e; // Save the event for later use
  const installButton = document.getElementById("install-button");
  if (installButton) {
    installButton.style.display = "flex"; // Show the install button
  }
});

function install() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === "accepted") {
        console.log("User accepted the A2HS prompt.");
      } else {
        console.log("User dismissed the A2HS prompt.");
      }
      deferredPrompt = null;
    });
  }
}

// SERVICE WORKER REGISTRATION
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => {
        console.log("Service Worker registered with scope:", registration.scope);
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  });
}

// NSFW MODAL HANDLING
document.addEventListener("DOMContentLoaded", () => {
  // const referrer = document.referrer;
  
  // // If there is a referrer, check if it's from the same site
  // if (referrer) {
  //   try {
  //     const referrerUrl = new URL(referrer);
  //     // Show modal only if the referrer hostname is different from the current hostname
  //     if (referrerUrl.hostname !== window.location.hostname) {
  //       showModal();
  //     }
  //   } catch (error) {
  //     // If parsing fails, fallback to showing the modal
  //     showModal();
  //   }
  // } else {
  //   // If there's no referrer (direct visit or privacy settings block it), show modal
  //   showModal();
  // }
  showModal()
});

function showModal() {
  const modal = document.getElementById("nsfwWarningModal");
  if (modal) {
    modal.style.display = "block";
  }
}

function closeModal() {
  const modal = document.getElementById("nsfwWarningModal");
  if (modal) {
    modal.style.display = "none";
  }
}


// PROFILE OVERLAY HANDLING
function showprofile(n) {
  const o = document.getElementById("overlay");
  const c = document.getElementById("content");
  if (!o || !c) return;

  if (n === 1) {
    o.style.display = "flex";
    c.style.display = "flex";
    // Trigger a reflow to ensure the browser notices the change
    c.offsetHeight; // This forces a reflow
    c.style.height = "70vh";
  } else {
    c.style.height = "0vh";
    setTimeout(() => {
      o.style.display = "none";
      c.style.display = "none";
    }, 500); // Delay matches the transition duration
  }
}
