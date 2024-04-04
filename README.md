[![pages-build-deployment](https://github.com/martinbroede/passwords/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/martinbroede/passwords/actions/workflows/pages/pages-build-deployment)

# Passwords

This is an unconventional password manager that instead of storing passwords in a database,
generates them on the fly based on a primary password and a domain name.
This way, you don't have to trust a third party with your passwords and you can easily generate the same password on different devices.
The generated passwords are basically SHA256 hashes of the primary password and the domain name with some modifications to
meet the password requirements of most websites.

## Usage

To keep the documentation DRY, I redirect you to the demo page which explains everything in detail:

[Demo Page](https://martinbroede.github.io/passwords/)
