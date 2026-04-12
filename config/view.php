<?php

return [

    'paths' => [
        resource_path('views'),
    ],

    /*
     * Use storage_path() only — not realpath(). If the folder was missing when
     * config was cached, realpath() becomes false and breaks view:clear / views.
     */
    'compiled' => env('VIEW_COMPILED_PATH', storage_path('framework/views')),

    'compiled_extension' => 'php',

];
