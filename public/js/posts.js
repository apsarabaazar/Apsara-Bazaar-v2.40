// Global object to track current image indexes per post
let currentImageIndexes = {};

// SHARE POST
async function sharePost(postId) {
  const shareData = {
    title: "Check out this post on Apsara Bazaar!",
    text: "Here’s an interesting post I found:",
    url: `https://apsarabazaar.onrender.com/post/details/${postId}`,
  };

  // Attempt to share if the Web Share API is available
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      console.log("Post shared successfully.");
    } catch (err) {
      console.error("Sharing failed:", err);
    }
    // Always copy the URL to clipboard afterward
    copyToClipboard(shareData.url);
  } else {
    // Fallback: just copy the URL to clipboard
    copyToClipboard(shareData.url);
  }
}

// COPY TO CLIPBOARD (with Clipboard API fallback)
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      console.log("Copied to clipboard using Clipboard API.");
    } catch (err) {
      console.error("Failed to copy text using Clipboard API:", err);
    }
  } else {
    // Fallback method for older browsers
    const tempInput = document.createElement("input");
    tempInput.style.position = "absolute";
    tempInput.style.left = "-9999px";
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
      document.execCommand("copy");
      console.log("Copied to clipboard using execCommand.");
    } catch (err) {
      console.error("execCommand copy failed:", err);
    }
    document.body.removeChild(tempInput);
  }
}

// REDIRECT TO PROFILE
function redirectToProfile(username) {
  document.getElementById("loading-overlay").style.display = "flex";
  setTimeout(function () {
    window.location.href = `/user/profile/${username}`;
  }, 750); // 100ms delay so the overlay appears
}

// FULLSCREEN IMAGE HANDLING
function openFullscreenImage(postId) {
  const imgElem = document.getElementById(`img-${postId}`);
  const fullScreenImage = document.getElementById("fullScreenImage");
  const fullScreenImageContainer = document.getElementById(
    "fullScreenImageContainer"
  );

  if (imgElem && fullScreenImage && fullScreenImageContainer) {
    fullScreenImage.src = imgElem.src;
    fullScreenImageContainer.style.display = "flex";
  }
}

function closeFullscreenImage() {
  const fullScreenImageContainer = document.getElementById(
    "fullScreenImageContainer"
  );
  if (fullScreenImageContainer) {
    fullScreenImageContainer.style.display = "none";
  }
}

// IMAGE NAVIGATION

function showLoader(postId) {
  const imgElem = document.getElementById(`img-${postId}`);
  console.log("Trying to update loader")
  if (!imgElem) 
    {
      console.log("Didnt Found")
 
      return
    };

  imgElem.style.opacity = "0.5"; // Reduce opacity to indicate loading
}

function hideLoader(postId) {
  const imgElem = document.getElementById(`img-${postId}`);
  if (!imgElem) return;
  setTimeout(() => {
    imgElem.style.opacity = "1";  // Restore opacity when loaded
  }, 100);
 
}



function prevImage(postId) {
  const imgElem = document.getElementById(`img-${postId}`);
  if (!imgElem) return;

  const imagesAttr = imgElem.getAttribute("data-images");
  if (!imagesAttr) return;

  let images;
  try {
    images = JSON.parse(imagesAttr);
  } catch (err) {
    console.error("Invalid JSON in data-images:", err);
    return;
  }

  currentImageIndexes[postId] = currentImageIndexes[postId] || 0;
  currentImageIndexes[postId] =
    currentImageIndexes[postId] > 0
      ? currentImageIndexes[postId] - 1
      : images.length - 1;

  showLoader(postId); // Show loader before loading new image

  const newImage = new Image();
  newImage.src = images[currentImageIndexes[postId]];
  newImage.onload = () => {
    imgElem.src = newImage.src;
    hideLoader(postId); // Hide loader when image is loaded
    updateImageCounter(postId, currentImageIndexes[postId], images.length);
  };
}

function nextImage(postId) {
  const imgElem = document.getElementById(`img-${postId}`);
  if (!imgElem) return;

  const imagesAttr = imgElem.getAttribute("data-images");
  if (!imagesAttr) return;

  let images;
  try {
    images = JSON.parse(imagesAttr);
  } catch (err) {
    console.error("Invalid JSON in data-images:", err);
    return;
  }

  currentImageIndexes[postId] = currentImageIndexes[postId] || 0;
  currentImageIndexes[postId] =
    currentImageIndexes[postId] < images.length - 1
      ? currentImageIndexes[postId] + 1
      : 0;

  showLoader(postId); // Show loader before loading new image

  const newImage = new Image();
  newImage.src = images[currentImageIndexes[postId]];
  newImage.onload = () => {
    imgElem.src = newImage.src;
    hideLoader(postId); // Hide loader when image is loaded
    updateImageCounter(postId, currentImageIndexes[postId], images.length);
  };
}




function updateImageCounter(postId, currentIndex, total) {
  const counterElem = document.getElementById(`img-counter-${postId}`);
  console.log("Trying to update image counter of : "+postId +"to"+currentIndex+1)
  if (counterElem) {
      counterElem.innerText = (currentIndex + 1) + " / " + total;
  }
}

 //Time Shower
 function timeAgo(isoDate) {
  const timeUnits = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 }
  ];
  const now = new Date();
  const past = new Date(isoDate);
  const diffInSeconds = Math.floor((now - past) / 1000);
  for (let unit of timeUnits) {
    const interval = Math.floor(diffInSeconds / unit.seconds);
    if (interval >= 1) {
      return `${interval} ${unit.label}${interval > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}
