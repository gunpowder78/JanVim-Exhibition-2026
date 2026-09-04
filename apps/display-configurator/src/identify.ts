import "./styles.css";

const output = document.querySelector<HTMLElement>("[data-identify-number]");
if (output === null) throw new Error("Identify card number is missing");
const value = new URL(window.location.href).searchParams.get("number") ?? "";
output.textContent = /^(?:[1-9]|1[0-6])$/u.test(value) ? value : "?";
