cmake_minimum_required(VERSION 3.22.1)
project(ac2aaudio CXX)

add_library(ac2aaudio SHARED aaudio_sink.cpp)

target_compile_features(ac2aaudio PRIVATE cxx_std_17)
target_compile_options(ac2aaudio PRIVATE -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(ac2aaudio log aaudio)
