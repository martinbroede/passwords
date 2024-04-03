// ==UserScript==
// @name         Password Generator
// @namespace    http://tampermonkey.net/
// @version      2024-03-31
// @description  Generate secure passwords
// @author       Martin Broede
// @match        https://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant GM_setValue
// @grant GM_getValue
// ==/UserScript==

/*
 * This script is a user script that can be used in the Tampermonkey browser extension.
 * It generates secure passwords for websites based on a primary password.
 * The generated password is basically the SHA-256 hash of the primary password + the domain name.
 * To meet the password requirements of most websites, the hash is modified to contain at least
 * one digit, one lowercase letter, one uppercase letter and one special character.
 * To accomplish this, the hash is encoded with the following base-90 alphabet:
 * 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%"&/\()_+-=[]{};:'|,.<>?
 *
 * The script provides a shortcut to trigger the password prompt [CTRL + ALT + G]
 * and shortcuts to fill in the username in the username input fields [CTRL + ALT + 0-9].
 * If you want to delete the stored usernames, use [CTRL + ALT + MINUS]
 *
 * KEEP IN MIND THAT, AS IN EVERY PASSWORD MANAGER, THE PRIMARY PASSWORD IS THE KEY TO ALL OTHER PASSWORDS!
 * THEREFORE, IT IS IMPORTANT TO KEEP THE PRIMARY PASSWORD SECURE AND TO NOT SHARE IT WITH ANYONE!
 */

"use strict";

const MIN_HASH_LENGTH = 4;
const MAX_HASH_LENGTH = 40;
const DEFAULT_HASH_LENGTH = 16;

const TIMEOUT = 300;

const COLOR_CODE_RED = "#E44";
const COLOR_CODE_BLUE = "#48F";

const BASE_90_ALPHABET = `0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%"&/\\()_+-=[]{};:'|,.<>?`;

const tempStorage = {};

/**
 * Converts the input number to a base-xx string
 * with xx being the length of the given alphabet.
 * @param {number} input
 * @param {string} alphabet - an alphabet with unique ASCII characters
 * @returns {string}
 */
function convertToString(input, alphabet) {
  const base = alphabet.length;
  let result = "";
  while (input > 0) {
    result = alphabet[input % base] + result;
    input = Math.floor(input / base);
  }
  return result ? result : alphabet[0];
}

/**
 * Checks if the BASE_90_ALPHABET does not not hurt the constraints.
 * Tests the convertToString function.
 * @returns {void}
 */
function test() {
  console.assert(BASE_90_ALPHABET.length === 90, "BASE_90_ALPHABET");
  console.assert(new Set(BASE_90_ALPHABET).size === BASE_90_ALPHABET.length, "Alphabet contains duplicate characters");
  console.assert(
    [...BASE_90_ALPHABET].every((char) => char.charCodeAt(0) <= 127),
    "Alphabet contains non-ASCII characters"
  );
  console.assert(convertToString(0, BASE_90_ALPHABET) === "0", "0");
  console.assert(convertToString(89, BASE_90_ALPHABET) === "?", "?");
  console.assert(convertToString(90, BASE_90_ALPHABET) === "10", "10");
  console.assert(convertToString(8100, BASE_90_ALPHABET) === "100", "100");
  console.assert(convertToString(8189, BASE_90_ALPHABET) === "10?", "10?");
}

/**
 * Gets a value from the storage.
 * Uses the Tampermonkey API if available, otherwise uses a temporary storage.
 * @param {string} key
 * @returns {string}
 */
function getValue(key) {
  // @ts-ignore
  if (typeof GM_getValue === "function") {
    // @ts-ignore
    return GM_getValue(key);
  } else return tempStorage[key];
}

/**
 * Sets a value in the storage.
 * Uses the Tampermonkey API if available, otherwise uses a temporary storage.
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function setValue(key, value) {
  // @ts-ignore
  if (typeof GM_setValue === "function") {
    // @ts-ignore
    GM_setValue(key, value);
  } else tempStorage[key] = value;
}

/**
 * Creates an overlay and a message toast
 * that disappears after one second.
 * You can optionally pass a color code as the second argument.
 * @param {string} message
 * @param {string} colorCode
 * @returns {void}
 */
function createToast(message, colorCode = "#eef") {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.backgroundColor = "#222E";
  overlay.style.display = "flex";
  overlay.style.justifyContent = "center";
  overlay.style.alignItems = "center";
  overlay.style.zIndex = "5000";
  overlay.style.color = colorCode;
  overlay.style.fontFamily = "Arial, sans-serif";

  const toast = document.createElement("div");
  toast.innerHTML = message;
  toast.style.fontSize = "2rem";

  overlay.appendChild(toast);
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.remove();
  }, 750);
}

/**
 * Sets up the shortcut to trigger the password prompt.
 * @returns {void}
 */
function installShortcuts() {
  const shortcutKey = "Alt";
  let isAltPressed = false;

  document.addEventListener("keydown", function (event) {
    if (event.altKey && event.key === shortcutKey) {
      isAltPressed = true;
    }
  });

  document.addEventListener("keyup", function (event) {
    if (event.key === shortcutKey) {
      isAltPressed = false;
    }

    if (isAltPressed && event.key === "g") {
      createPasswordPrompt();
      isAltPressed = false;
    } else if (isAltPressed && Number(event.key) >= 0 && Number(event.key) <= 9 && event.key !== " ") {
      addUserName("user_" + event.key);
    } else if (isAltPressed && event.key === "-") {
      deleteAllValues();
      isAltPressed = false;
    }
  });
}

/**
 * Simulates a key press event on the input field
 * to trigger input validation.
 * @param {HTMLInputElement} field
 * @returns {void}
 */
function triggerInputValidation(field) {
  const events = ["change", "input", "keydown", "keypress", "keyup"];
  for (let i = 0; i < events.length; i++) {
    const event = new Event(events[i], {
      bubbles: true,
      cancelable: false,
    });
    field.dispatchEvent(event);
  }
  field.focus();
}

/**
 * Inserts the password into all password input fields
 * except for those that contain the current / old password.
 * @param {string} password
 */
function insertPassword(password) {
  const passwordInputFields = document.querySelectorAll("input");
  passwordInputFields.forEach((field) => {
    if (field.type === "password" && !field.name.includes("old") && !field.name.includes("current")) {
      field.value = password;
      setTimeout(() => {
        triggerInputValidation(field);
      }, 10);
    }
  });
}

/**
 * Returns the SHA-256 as an integer.
 * @param {string} input
 * @returns {Promise<number>} The hash as an integer
 */
async function getSHA256asInt(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return parseInt(hashHex, 16);
}

/**
 * Returns the SHA-256 as a base36 string.
 * @param {string} input
 * @returns {Promise<string>} The hash as a base36 string
 */
async function getSHA256asBase36String(input) {
  return (await getSHA256asInt(input)).toString(36);
}

/**
 * Generates a hash from the input string
 * that will meet the password requirements
 * of most websites.
 * Basically the hash is a shortened SHA-256 hash of the input
 * with modifications to make it a valid password,
 * i.e., it contains at least one digit, one lowercase letter,
 * one uppercase letter and one special character.
 * The hash is generated with a salt that is incremented
 * until the hash meets the password requirements.
 * @param {string} input
 * @param {number} outputLength
 * @param {number} salt
 */
async function generateHash(input, outputLength = DEFAULT_HASH_LENGTH, salt = 0) {
  if (outputLength < 4) {
    throw Error("Minimum length is 4 (uppercase, lowercase, digit, special character");
  }
  if (outputLength > 40) {
    throw Error("A base 90 encoded SHA256 can not have more than 40 characters.");
  }
  const hash = await getSHA256asInt(input + salt);
  let output = convertToString(hash, BASE_90_ALPHABET);
  output = output.slice(0, outputLength);

  // check if the output contains at least one digit, one lowercase letter, one uppercase letter
  // and one special character and has the correct length
  // if not, generate a new hash with a different salt

  const hasLowerCase = /[a-z]/.test(output);
  const hasUpperCase = /[A-Z]/.test(output);
  const hasNumber = /[0-9]/.test(output);
  const hasSpecChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(output);
  const hasCorrectLength = output.length === outputLength;

  if (hasLowerCase && hasUpperCase && hasNumber && hasSpecChar && hasCorrectLength) {
    return output;
  }
  return generateHash(input, outputLength, salt + 1);
}

/**
 * Stores the hash of the password in the storage
 * @param {string} password
 * @returns {Promise<void>}
 */
async function storePasswordHash(password) {
  const hash = await getSHA256asBase36String(password);
  if (!getValue("pwHash")) {
    setValue("pwHash", hash);
    console.info("Stored password hash", hash);
  } else if (getValue("pwHash") !== hash) {
    createToast("This is not your primary password", COLOR_CODE_RED);
  }
}

/**
 * Creates a password prompt that will insert the generated password
 * into all password input fields on the current page.
 * @returns {void}
 */
function createPasswordPrompt() {
  /**
   * To be executed when the user submits the password.
   * Will
   * @param {Event} event
   */
  async function onInput(event) {
    event.preventDefault();

    const password = input.value || "";
    const hostname = window.location.hostname || "";
    let domainname = "";

    if (hostname) {
      domainname = extractDomain(hostname);
    }

    await storePasswordHash(password);

    const generatedPassword = await generateHash(domainname + password);

    console.debug(`Generated hash from primary password with domain name '${domainname}'`);
    console.assert(password !== "", "password is empty");
    console.assert(domainname !== "", "domainname is empty");

    insertPassword(generatedPassword);

    div.remove();
  }

  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.top = "0";
  div.style.left = "0";
  div.style.width = "100%";
  div.style.height = "100%";
  div.style.backgroundColor = "#222E";
  div.style.display = "flex";
  div.style.justifyContent = "center";
  div.style.alignItems = "center";
  div.style.zIndex = "4999";
  div.style.color = "#eef";
  div.style.fontFamily = "Arial, sans-serif";

  const label = document.createElement("label");
  label.htmlFor = "password";
  label.style.display = "block";
  label.innerText = "Password";
  label.style.fontSize = "2rem";

  const input = document.createElement("input");
  input.type = "password";
  input.style.fontSize = "2rem";
  input.style.backgroundColor = "#FFFE";
  input.style.display = "block";
  input.style.width = "100%";
  input.style.maxWidth = "400px";
  input.style.color = "#111";
  input.autocomplete = "off";

  const lineBreak = document.createElement("br");

  const form = document.createElement("form");

  form.appendChild(label);
  form.appendChild(lineBreak);
  form.appendChild(input);

  div.appendChild(form);

  document.body.appendChild(div);

  form.onsubmit = onInput;
  input.focus();
}

/**
 * Fills in the username in the username input field
 * @param {string} userNameKey
 */
function addUserName(userNameKey) {
  let userName = getValue(userNameKey);

  if (!userName) {
    userName = prompt(`Enter value for key '${userNameKey}'`) || "";
    if (userName) {
      createToast(`Saved ${userNameKey}/${userName}`, COLOR_CODE_BLUE);
    }
  }

  if (userName) {
    setValue(userNameKey, userName);
    const inputElements = document.querySelectorAll("input");
    let found = false;

    inputElements.forEach((field) => {
      if (field.type === "text" && field.name.toLowerCase().includes("user")) {
        field.value = userName;
        triggerInputValidation(field);
        found = true;
      } else if (field.type === "text" && field.id.toLowerCase().includes("username")) {
        field.value = userName;
        triggerInputValidation(field);
        found = true;
      } else if (field.type === "text" && field.autocomplete === "username") {
        field.value = userName;
        triggerInputValidation(field);
        found = true;
      }
    });

    if (!found) {
      inputElements.forEach((field) => {
        if (field.type === "email") {
          field.value = userName;
          triggerInputValidation(field);
        } else if (field.id === "email") {
          field.value = userName;
          triggerInputValidation(field);
        }
      });
    }
  }
}

/**
 * Deletes all values from the storage.
 * @returns {void}
 */
function deleteAllValues() {
  for (let i = 0; i < 10; i++) {
    setValue("user_" + i, "");
  }
  setValue("pwHash", "");
  createToast("Deleted stored usernames<br/>Reset primary password", COLOR_CODE_RED);
}

/**
 * Extracts the domain name from the URL. If the given string
 * is not a valid URL, the input string is returned.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  const domainRegex = /(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/\n?]+)/g;
  const matches = domainRegex.exec(url);
  if (matches && matches.length > 1) {
    const domainParts = matches[1].split(".");
    if (domainParts.length > 2) {
      return domainParts[domainParts.length - 2] + "." + domainParts[domainParts.length - 1];
    } else {
      return matches[1];
    }
  }
  return url;
}

test();
if (!["github.io", "0.1"].includes(extractDomain(window.location.hostname))) {
  installShortcuts();
}

// *********************************************************************************************************************
// THE CODE BELOW IS ONLY USED IN THE DEMO APPLICATION AND NOT IN THE USER SCRIPT
// IT DOES NOT AFFECT THE FUNCTIONALITY OF THE USER SCRIPT THOUGH
// *********************************************************************************************************************

let hasIntervalBeenSet = false;

/**
 * Generates a password hash from the input fields and displays it in the hashOutput field.
 * If no input values are given, the hashOutput value is set to an empty string.
 * @returns {void}
 */
function onChange() {
  const domainInput = /** @type {HTMLInputElement} */ (document.getElementById("domain"));
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById("url"));
  const passwordInput = /** @type {HTMLInputElement} */ (document.getElementById("password"));
  const extractInput = /** @type {HTMLInputElement} */ (document.getElementById("extract"));
  const lengthInput = /**@type {HTMLInputElement} */ (document.getElementById("length"));
  const hashOutput = /** @type {HTMLInputElement} */ (document.getElementById("hash"));
  const countdownSpan = /**@type {HTMLSpanElement} */ (document.getElementById("countdown"));
  const showPassword = /**@type {HTMLInputElement} */ (document.getElementById("show"));

  const length = Number(lengthInput.value);
  if (!isNaN(length) && (length < MIN_HASH_LENGTH || length > MAX_HASH_LENGTH)) {
    lengthInput.classList.add("w3-pale-red");
  } else {
    lengthInput.classList.remove("w3-pale-red");
  }

  if (!hasIntervalBeenSet) {
    setInterval(cleanUp, 1000);
    hasIntervalBeenSet = true;
  }

  if ((countdownSpan.innerText = "*")) {
    countdownSpan.innerText = String(TIMEOUT);
  }

  domainInput.value = extractInput.checked ? extractDomain(urlInput.value) : urlInput.value;

  if (domainInput.value + passwordInput.value === "" || Number(lengthInput.value) < MIN_HASH_LENGTH) {
    hashOutput.value = "";
    return;
  }

  generateHash(domainInput.value + passwordInput.value, Math.max(Number(lengthInput.value), MIN_HASH_LENGTH)).then(
    (hash) => {
      hashOutput.value = showPassword.checked ? hash : obfuscatePassword(hash);
    }
  );
}

/**
 * Returns the first and last character of the text.
 * The rest is replaced by asterisks.
 * @param {string} text
 */
function obfuscatePassword(text) {
  return text.slice(0, 1) + "*".repeat(text.length - 2) + text.slice(-1);
}

/**
 * Copies the hash to the clipboard in case the hashOutput field is not empty.
 * The hash needs to be generated before it can be copied
 * because the hashOutput field is obfuscated.
 * @returns {void}
 */
function copyToClipboard() {
  const domainInput = /** @type {HTMLInputElement} */ (document.getElementById("domain"));
  const passwordInput = /** @type {HTMLInputElement} */ (document.getElementById("password"));
  const lengthInput = /**@type {HTMLInputElement} */ (document.getElementById("length"));
  const hashOutput = /** @type {HTMLInputElement} */ (document.getElementById("hash"));

  if (!hashOutput.value) {
    createToast("Nothing to copy", COLOR_CODE_RED);
    return;
  }

  generateHash(domainInput.value + passwordInput.value, Number(lengthInput.value)).then((hash) => {
    navigator.clipboard
      .writeText(hash)
      .then(() => {
        createToast("Copied to clipboard", COLOR_CODE_BLUE);
      })
      .catch(() => {
        createToast("Copying not possible", COLOR_CODE_RED);
      });
  });
}

/**
 * Clears the clipboard so the password can not be pasted anymore.
 * @returns {void}
 */
function clearAll() {
  const passwordInput = /** @type {HTMLInputElement} */ (document.getElementById("password"));
  const hashOutput = /** @type {HTMLInputElement} */ (document.getElementById("hash"));

  hashOutput.value = "";
  passwordInput.value = "";

  navigator.clipboard
    .writeText("")
    .then(() => {
      createToast("Cleared clipboard", COLOR_CODE_BLUE);
    })
    .catch(() => {
      createToast("Clearing clipboard not allowed", COLOR_CODE_RED);
    });
}

/**
 * Cleans up the input fields for security reasons after a certain time
 * so that the password can not be copied anymore.
 * @returns {void}
 */
function cleanUp() {
  const passwordInput = /** @type {HTMLInputElement} */ (document.getElementById("password"));
  const hashOutput = /** @type {HTMLInputElement} */ (document.getElementById("hash"));
  const countdownSpan = /** @type {HTMLSpanElement} */ (document.getElementById("countdown"));
  const countdown = Number(countdownSpan.innerText);

  if (isNaN(countdown)) {
    return;
  }
  if (countdown > 0) {
    countdownSpan.innerText = String(countdown - 1);
  } else {
    hashOutput.value = "";
    passwordInput.value = "";
    countdownSpan.innerText = String("*");
  }
}
