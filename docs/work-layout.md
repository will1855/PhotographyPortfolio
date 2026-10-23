# Editorial layout updates

No SQL migration is required. Layouts continue to use version 2 JSON stored as text in portfolio_sections.layout_json. Existing layouts retain their image order and individual row placement.

In Admin → My Work, set an image's Row control to **Pair with previous** to place it beside the preceding image. Pairs contain two images, retain their individual captions, use the image widths as relative proportions, and stack on mobile. The last image's Gap controls space after the row. Pair captions appear below their images so they do not collide with neighbouring photos.

The optional boolean pairWithPrevious is stored on the second image item. Reordering, unpairing, and saving use the existing Save Layout action. A three-image chain starts a new row; the first item cannot pair backwards. No database rows were edited by the code update.

The public Work page now chooses between 600px, 1600px, and original image candidates, reserves their aspect ratios, and moves side captions below when the viewport has insufficient space. The About page uses the existing biography, portrait and contact settings.
