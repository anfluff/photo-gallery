#!/bin/sh
# Copies the image files in public/photos to the server, and removes from the
# server the files that are no longer here. The files are not in git, so the
# deploy on GitHub does not carry them.
#
# Run it before pushing a change that adds photos, so the page never asks for
# a file that is not there yet.
#
#   npm run upload
#
# PHOTOS_TARGET and PHOTOS_KEY replace the server path and the SSH key.
set -eu

cd "$(dirname "$0")/.."

target="${PHOTOS_TARGET:-root@photos.apraksin.xyz:/srv/apraksin/photos/images/}"
key="${PHOTOS_KEY:-$HOME/.ssh/id_rsa_personal}"

if [ ! -d public/photos/thumb ] || [ ! -d public/photos/full ]; then
  echo "public/photos has no images. Run the import first." >&2
  exit 1
fi

# -rt and not -a, because the files on the server belong to root and not to the user of this laptop.
rsync -rt --delete --stats \
  -e "ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  public/photos/ "$target"
