# Cryptex
### Steganography Tool for Images

Cryptex is a client‑side web application that lets you hide multiple images inside a single PNG container.  
You can optionally supply a carrier image – if none is given, a random noise image is automatically generated.  
The resulting container looks like a normal PNG but can later be unpacked to retrieve all original files.

---

## Features

- **Pack multiple images** into one PNG container  
- **Preserve folder structure** – optionally include images from subfolders  
- **Custom carrier image** – use your own image as the visible decoy  
- **Auto‑generated carrier** – if no decoy is chosen, a random noise image is created  
- **GZip compression** – payload is compressed before embedding  
- **PNG chunk‑based storage** – uses a standard ancillary chunk (`crPx`) for reliable extraction  
- **No server required** – everything runs in your browser  
- **Drag & drop support** – also works with folder selection (where supported)  
- **Built‑in preview gallery** – browse extracted images in a modal window  
- **Download individually or as a batch** – after extraction, download all files at once  

---

## How It Works

### Packing (Embedding)

1. **Input** – You select a folder containing images (optionally with subfolders) and, optionally, a carrier image.  
2. **Metadata** – For each file its original path, size, and type are stored.  
3. **Payload construction** – All image files, the metadata JSON, a length field, and a signature (`CRYPTEX`) are concatenated.  
4. **Compression** – The raw payload is compressed using GZip (if the browser supports `CompressionStream`).  
5. **Embedding** – The compressed payload is inserted into the carrier PNG as a new custom chunk named `crPx` (ancillary, private, safe‑to‑copy).  
6. **Output** – The modified PNG is offered for download.

### Unpacking (Extraction)

1. **Input** – You provide a PNG container created by Cryptex.  
2. **Chunk scanning** – The tool scans the PNG chunks, looking for the `crPx` chunk or any ancillary chunk that begins with the GZip magic bytes (`0x1F 0x8B`).  
3. **Decompression** – The extracted payload is decompressed (if compressed).  
4. **Validation** – The signature at the end is checked, and the metadata length is read to locate the JSON metadata.  
5. **Reconstruction** – The images are sliced from the payload using the sizes stored in the metadata.  
6. **Display** – Extracted files are shown in a folder‑style grid; you can preview or download them.

---

## Usage

### Pack Images

1. Open the **Pack Images** tab.  
2. Drag a folder onto the “Source Folder” area, or click to select a folder using the file picker.  
   - If your browser does not support folder selection, use the hidden fallback input to select multiple image files.  
3. (Optional) Toggle “Include Subfolders” to pack images from nested directories.  
4. (Optional) Drag an image onto the “Carrier Image” area, or click to select one. If you leave this empty, a random noise image will be generated automatically.  
5. Click **Generate Container Image**.  
6. Wait for the process to finish. A summary and a download button will appear.  
7. Click **Download Container Image** to save the resulting PNG.

### Unpack Images

1. Switch to the **Unpack Images** tab.  
2. Drag a Cryptex‑generated PNG onto the “Container Image” area, or click to select it.  
3. Click **Extract Images**.  
4. After extraction, the extracted files are displayed in a grid grouped by their original folders.  
5. Click any thumbnail to open a full‑size preview.  
6. Use the **Download All Images** button to save every extracted file at once (files are downloaded one after another).

---

## Technical Details

- **PNG chunk structure** – The container is a standard PNG. The payload is stored in a custom ancillary chunk named `crPc` (four‑byte type). This chunk is ignored by ordinary image viewers.  
- **Compression** – Payload compression uses the browser’s native `CompressionStream` API (GZip). If the API is unavailable, the payload is stored uncompressed.  
- **Signature** – The literal string `CRYPTEX` is appended to the payload for integrity verification.  
- **Metadata** – A JSON array holds the original file paths, sizes, and MIME types.  
- **Fallback extraction** – For backward compatibility, the tool also supports the legacy method where data was appended after the PNG `IEND` chunk.

---

## Credits

- **Fonts** – [Syne](https://fonts.google.com/specimen/Syne) and [DM Mono](https://fonts.google.com/specimen/DM+Mono) from Google Fonts  
- **Icons** – [Font Awesome](https://fontawesome.com) (Free version)  
