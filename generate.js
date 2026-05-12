const fs = require("fs");

const files = fs.readdirSync("./images");

const images = files.filter(file =>
  file.match(/\.(jpg|jpeg|png|webp)$/i)
);

fs.writeFileSync("images.json", JSON.stringify(images, null, 2));

console.log("images.json updated!");