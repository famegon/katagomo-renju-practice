cmake_minimum_required(VERSION 3.18.2)
project(katagomo_forbidden_helper LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

get_filename_component(PROJECT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(KATAGOMO_CPP "${PROJECT_ROOT}/vendor/KataGomo/cpp")

add_executable(forbidden_helper
  main.cpp
  "${KATAGOMO_CPP}/game/board.cpp"
  "${KATAGOMO_CPP}/game/gamelogic.cpp"
  "${KATAGOMO_CPP}/forbiddenPoint/ForbiddenPointFinder.cpp"
  "${KATAGOMO_CPP}/core/global.cpp"
  "${KATAGOMO_CPP}/core/hash.cpp"
  "${KATAGOMO_CPP}/core/rand.cpp"
  "${KATAGOMO_CPP}/core/md5.cpp"
  "${KATAGOMO_CPP}/core/sha2.cpp"
  "${KATAGOMO_CPP}/core/timer.cpp"
  "${KATAGOMO_CPP}/core/bsearch.cpp"
)

target_include_directories(forbidden_helper PRIVATE "${KATAGOMO_CPP}")
target_compile_options(forbidden_helper PRIVATE -ffunction-sections -fdata-sections)

if(APPLE)
  # gamelogic.cpp is an unmodified official translation unit. Remove its unused
  # VCF solver sections so this focused helper only links the Board path it calls.
  target_link_options(forbidden_helper PRIVATE "-Wl,-dead_strip")
endif()

