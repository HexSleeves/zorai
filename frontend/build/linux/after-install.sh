#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

SANDBOX='/opt/${sanitizedProductName}/chrome-sandbox'
if [ -f "$SANDBOX" ]; then
    chown root:root "$SANDBOX" || true
    chmod 4755 "$SANDBOX" || true
fi

APPARMOR_PROFILE='/etc/apparmor.d/opt.${sanitizedProductName}.${executable}'
if [ -d /etc/apparmor.d ] && [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
    cat > "$APPARMOR_PROFILE" << 'EOF'
abi <abi/4.0>,
include <tunables/global>

profile ${executable} /opt/${sanitizedProductName}/${executable} flags=(unconfined) {
  userns,
  include if exists <local/${executable}>
}
EOF
    if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser -r -W "$APPARMOR_PROFILE" >/dev/null 2>&1 || true
    fi
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
