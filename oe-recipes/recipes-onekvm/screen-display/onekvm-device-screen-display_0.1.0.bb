SUMMARY = "OneKVM screen display device plugin"
HOMEPAGE = "https://github.com/onekvm/onekvm-screen-display"
LICENSE = "MIT & OFL-1.1"
LIC_FILES_CHKSUM = "file://LICENSE;md5=94709c9b19d549c49355fc4fafb70d1a file://packaging/fonts/OFL.txt;md5=55719faa0112708e946b820b24b14097"
PR = "r15"
OPKGBUILDCMD = 'opkg-build -Z gzip'

ONEKVM_COMPONENT_GIT_URI ??= "git://github.com/onekvm/onekvm-screen-display.git;protocol=https;branch=main"
ONEKVM_COMPONENT_SRCREV ??= ""
SRC_URI = "${ONEKVM_COMPONENT_GIT_URI}"
SRCREV = "${ONEKVM_COMPONENT_SRCREV}"

inherit cargo onekvm-cargo-cache systemd qemu siteinfo

DEPENDS:append = " qemu-native"

CARGO_SRC_DIR = "host-linux-fb"
CARGO_DISABLE_BITBAKE_VENDORING = "1"
# This executable aborts on panic; native unwind tables only inflate resident code.
RUSTFLAGS:append = " -C force-unwind-tables=no"
CFLAGS:append = " -fno-asynchronous-unwind-tables -fno-unwind-tables"
CARGO_BUILD_FLAGS = "--target ${RUST_HOST_SYS} ${BUILD_MODE} --manifest-path=${CARGO_MANIFEST_PATH}"
# VDEC is a machine capability, not an AX630C special case. The machine that
# enables it supplies its own onekvm-video-* backend package and descriptor.
CARGO_BUILD_FLAGS:append = "${@bb.utils.contains('MACHINE_FEATURES', 'vdec', ' --no-default-features --features system-openh264,platform-vdec,compact-heap', '', d)}"
DEPENDS:append = "${@bb.utils.contains('MACHINE_FEATURES', 'vdec', ' openh264', '', d)}"
RDEPENDS:${PN}:append = "${@bb.utils.contains('MACHINE_FEATURES', 'vdec', ' openh264 (>= 2.6.0) openh264 (< 2.7.0)', '', d)}"
do_compile[network] = "1"
do_configure[network] = "1"

# Path dependencies are outside this recipe's externalsrc tree. Include their
# sources in task signatures so ABI/loader fixes cannot reuse an old binary.
python __anonymous() {
    # Run after externalsrc's anonymous setup, which replaces this flag.
    d.appendVarFlag('do_compile', 'file-checksums', ' /sources/onekvm-core/rust/Cargo.toml:True /sources/onekvm-core/rust/crates/onekvm-video:True /sources/onekvm-core/rust/crates/onekvm-devicebus:True /sources/onekvm-core/rust/crates/onekvm-net-address:True')
    d.appendVarFlag('do_compile', 'file-checksums', ' /sources/tmp/pocketjs/engine/crates/pocket-ui-surface:True')
    d.appendVarFlag('do_compile', 'file-checksums', ' /sources/tmp/pocketjs/engine/core/src:True /sources/tmp/pocketjs/engine/core/Cargo.toml:True')
    # The PocketJS bundles are generated locally and ignored by Git. Track
    # them separately so externalsrc cannot reuse an older screen package.
    d.appendVarFlag('do_install', 'file-checksums', ' %s/dist:True' % d.getVar('S'))
}

do_compile:prepend() {
    # Normalize OE target names to upstream QuickJS bindings. Its public FFI
    # uses C scalars and opaque handles, with no libc-specific FILE/time types;
    # the bundled ARMv7 GNU binding also matches musl's 32-bit AAPCS hard-float.
    ${CARGO} fetch --manifest-path=${CARGO_MANIFEST_PATH} --target ${RUST_HOST_SYS}
    for bindings in ${CARGO_HOME}/registry/src/*/rquickjs-sys-*/src/bindings; do
        if [ -d "$bindings" ] && [ ! -e "$bindings/${RUST_HOST_SYS}.rs" ]; then
            case "${RUST_HOST_SYS}" in
                arm*-*linux-musleabihf) source_bindings=armv7-unknown-linux-gnueabihf ;;
                aarch64-*) source_bindings=aarch64-unknown-linux-musl ;;
                *) echo "unsupported QuickJS target: ${RUST_HOST_SYS}" >&2; exit 1 ;;
            esac
            cp "$bindings/$source_bindings.rs" "$bindings/${RUST_HOST_SYS}.rs"
        fi
    done
}

COMPATIBLE_MACHINE = "^(onekvm-picokvm|onekvm-nanokvm-pro|onekvm-nanokvm-go)$"
PACKAGE_ARCH = "${MACHINE_ARCH}"

HOST_BIN = "${B}/target/${CARGO_TARGET_SUBDIR}/onekvm-screen-display"

do_install() {
    ${PYTHON} ${S}/scripts/check_bundles.py ${S}/dist
    test -x ${HOST_BIN} || {
        echo "missing ${HOST_BIN}; screen host compilation did not finish" >&2
        exit 1
    }
    install -Dm0755 ${HOST_BIN} \
        ${D}${libexecdir}/onekvm/onekvm-device-screen-display
    install -Dm0644 ${S}/packaging/systemd/onekvm-device-screen-display.service \
        ${D}${systemd_system_unitdir}/onekvm-device-screen-display.service
    install -Dm0644 ${S}/packaging/dbus/org.onekvm.ScreenDisplay.conf \
        ${D}${datadir}/dbus-1/system.d/org.onekvm.ScreenDisplay.conf
    install -Dm0644 ${S}/packaging/dbus/org.onekvm.ScreenDisplay.service \
        ${D}${datadir}/dbus-1/system-services/org.onekvm.ScreenDisplay.service
    install -Dm0644 ${S}/packaging/onekvm/screen-display-system-plugin.json \
        ${D}${datadir}/onekvm/system-plugins/screen-display.json
    install -Dm0644 ${S}/packaging/onekvm/display-page.js \
        ${D}${datadir}/onekvm/system-plugins/screen-display/0.1.0/web/display-page.js

    screen_dist=${D}${datadir}/onekvm/screen-display
    install -d ${screen_dist}/chrome ${screen_dist}/init ${screen_dist}/apps ${screen_dist}/icons
    install -m 0644 ${S}/dist/fallback-font.bin ${S}/dist/fallback-font.LICENSE ${screen_dist}/
    test -f ${S}/dist/init/main.vue-vapor.js || {
        echo "missing init bundle; run make app in onekvm-screen-display" >&2
        exit 1
    }
    install -m 0644 \
        ${S}/dist/init/main.vue-vapor.js \
        ${S}/dist/init/main.vue-vapor.jsc \
        ${S}/dist/init/main.vue-vapor.jsc.abi \
        ${S}/dist/init/main.vue-vapor.jsc.meta \
        ${S}/dist/init/main.vue-vapor.pak \
        ${screen_dist}/init/
    install -m 0644 \
        ${S}/dist/main.vue-vapor.js \
        ${S}/dist/main.vue-vapor.jsc \
        ${S}/dist/main.vue-vapor.jsc.abi \
        ${S}/dist/main.vue-vapor.jsc.meta \
        ${S}/dist/main.vue-vapor.pak \
        ${S}/dist/hint-atlas.bin \
        ${screen_dist}/
    install -m 0644 ${S}/packaging/onekvm/launcher.json ${screen_dist}/launcher.json
    cp -a ${S}/dist/chrome/. ${screen_dist}/chrome/
    cp -a ${S}/dist/apps/. ${screen_dist}/apps/
    cd ${screen_dist}
    for source in $(find . -name main.vue-vapor.js -type f); do
        ${@qemu_wrapper_cmdline(d, d.getVar('RECIPE_SYSROOT'), [d.getVar('RECIPE_SYSROOT') + d.getVar('libdir'), d.getVar('RECIPE_SYSROOT') + d.getVar('base_libdir')])} ${HOST_BIN} compile \
            "$source" "${source%.js}.jsc"
    done
    ${PYTHON} ${S}/scripts/check_bundles.py ${screen_dist} \
        "pocketjs/qjs-0.12.2/${SITEINFO_BITS}-${SITEINFO_ENDIANNESS}"
    if [ -d ${S}/dist/icons ]; then
        cp -a ${S}/dist/icons/. ${screen_dist}/icons/
    fi
    # Host-tree copies keep uid 1000; pseudo must record them as root.
    chown -R root:root ${D}${libexecdir}/onekvm ${screen_dist}
}

SYSTEMD_SERVICE:${PN} = "onekvm-device-screen-display.service"
SYSTEMD_AUTO_ENABLE:${PN} = "enable"
INSANE_SKIP:${PN} += "already-stripped"

RDEPENDS:${PN} += "dbus onekvm-adb-debug"
RDEPENDS:${PN}:append:onekvm-picokvm = " onekvm-machine-picokvm"
# Pro and PicoKVM have migrated to the device plugin; replace the old
# framebuffer renderer when upgrading an existing system as well as when
# building a new image. Both would draw to the same framebuffer.
RCONFLICTS:${PN}:append:onekvm-nanokvm-pro = " onekvm-extension-screen-display"
RREPLACES:${PN}:append:onekvm-nanokvm-pro = " onekvm-extension-screen-display"
RCONFLICTS:${PN}:append:onekvm-picokvm = " onekvm-extension-screen-display"
RREPLACES:${PN}:append:onekvm-picokvm = " onekvm-extension-screen-display"
FILES:${PN} += "${libexecdir}/onekvm ${datadir}/dbus-1 ${datadir}/onekvm"
