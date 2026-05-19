# Photography Portfolio

A personal photography portfolio built to present my work in a clean, image-led format.

Live site: https://willdaviesphoto.co.uk

![Hero Screenshot](docs/readme/hero.png)

## Overview

This is my personal photography portfolio site. I wanted the site to feel simple, cinematic, and focused on the images rather than heavy UI. It includes separate sections for selected work and archive images, with an admin area for managing content.

## Screenshots

![Gallery Screenshot](docs/readme/gallery.png)

## Features

- Full-screen hero image
- Image-led gallery layout
- Separate “My Work” and “Archive” sections
- About page
- Admin area for uploading and ordering images
- Hero image/content management
- Basic analytics/messages/settings sections
- Responsive layout for different screen sizes

## Admin Tools

The custom admin area lets me upload new photographs, reorder them in the gallery, and manage general site content directly. This makes it easy to update my portfolio and refresh the landing page image from any device without needing to edit the source code or redeploy.

![Admin Screenshot](docs/readme/admin.png)

## Tech Stack

This project is built using:

- **JavaScript**: Core programming language for both client-side interactivity and server-side logic.
- **Node.js & Express**: Powers the backend routing, authentication middleware, API endpoints, and server functionality.
- **HTML/CSS**: Standard markup and custom CSS for a clean, responsive dark-themed grid.
- **Supabase**: Handles the PostgreSQL database for image metadata and messages, and provides storage buckets for the photography files.
- **JSON Web Tokens (JWT)**: Secures the admin dashboard routes with stateless session cookies.
- **Sharp**: Generates image thumbnails on the fly during uploads.
- **Vercel**: Handles hosting and deployment.
- **Playwright**: Automates end-to-end testing to verify page layouts and navigation.

## Notes

This portfolio is a personal project that I am refining as I add more photography and improve the portfolio presentation. Future updates will focus on fine-tuning responsive layouts and optimizing image loading performance.
