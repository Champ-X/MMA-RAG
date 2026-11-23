# Material-space illustrations and display font

The material-space header and empty state share the collection illustration and four modality illustrations. The empty state gives each modality an accessible label. The populated header puts the label and count beside a decorative icon. The create action opens the existing dialog and restores focus when the dialog closes. [Empty state](../frontend/src/components/knowledge/KnowledgeLibraryEmpty.tsx) · [Header](../frontend/src/components/knowledge/KnowledgeLibraryHeader.tsx)

## Illustration sources

The collection artwork is a 1536 × 1024 WebP with transparency. The published conversion used `cwebp -q 90 -m 6 -exact`. The four modality illustrations are 1254 × 1254. Each source record contains the original generation prompt and timestamp.

| Illustration | Published WebP | Source record |
| --- | --- | --- |
| Collection | [Image](../frontend/public/knowledge/empty-collection.webp) | [Generation record](../frontend/public/knowledge/empty-collection.webp.json) |
| Documents | [Image](../frontend/public/knowledge/material-documents.webp) | [Generation record](../frontend/public/knowledge/material-documents.webp.json) |
| Images | [Image](../frontend/public/knowledge/material-images.webp) | [Generation record](../frontend/public/knowledge/material-images.webp.json) |
| Audio | [Image](../frontend/public/knowledge/material-audio.webp) | [Generation record](../frontend/public/knowledge/material-audio.webp.json) |
| Video | [Image](../frontend/public/knowledge/material-video.webp) | [Generation record](../frontend/public/knowledge/material-video.webp.json) |

## Chinese display font

The header and empty-state title use a self-hosted Ma Shan Zheng Regular subset. Its manifest records the upstream font, source and output hashes, Unicode coverage and subsetting tool. Distribute the SIL Open Font License with the font. [Font manifest](../frontend/public/knowledge/fonts/knowledge-display.json) · [License](../frontend/public/knowledge/fonts/OFL-MaShanZheng.txt)
