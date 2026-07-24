#pragma once

#include <spa/utils/defs.h>
#include <pipewire/core.h>

/*
 * PipeWire defines this as ((uint32_t)0xffffffff). Clang 22 and bindgen 0.72
 * fail to emit that casted macro, so restate the identical value in a form
 * bindgen can export for libspa 0.10.
 */
#undef SPA_ID_INVALID
#define SPA_ID_INVALID 0xffffffffU

/* The matching PipeWire sentinel uses the same casted form and needs the
 * same treatment for pipewire-sys. */
#undef PW_ID_ANY
#define PW_ID_ANY 0xffffffffU
