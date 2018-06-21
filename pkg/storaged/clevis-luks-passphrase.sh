#! /bin/bash

if [ $# -ne 1 ]; then
    echo >&2 "usage: $0 DEV"
    exit 1
fi

DEV=$1
CLEVIS_UUID=cb6e8904-81ff-40da-a84a-07ab9ab5715e

luksmeta test -d "$DEV" 2>/dev/null || exit 0

luksmeta show -d "$DEV" | while read slot state uuid; do
    if [ "$state" == "active" -a "$uuid" == "$CLEVIS_UUID" ]; then
        if pp=$(luksmeta load -d "$DEV" -s "$slot" | clevis decrypt); then
            echo $pp
            break
        fi
    fi
done
