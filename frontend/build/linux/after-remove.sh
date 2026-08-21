#!/bin/bash

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE='/etc/apparmor.d/opt.${sanitizedProductName}.${executable}'
if [ -f "$APPARMOR_PROFILE" ]; then
    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -R "$APPARMOR_PROFILE" >/dev/null 2>&1 || true
    fi
    rm -f "$APPARMOR_PROFILE"
fi
