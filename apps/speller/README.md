# A P300 speller demo

## Events sent to stream ``events``

Label                           | Data
------------------------------- | ----
``session_begins``              | ``{ "symbols": <string>, "columns": <int>, "groups": <array><array><int>, "repetitions": <int> }``
``calibration_begins``          | ``null``
``baseline-eyes-open_begins``   | ``null``
``baseline-eyes-open_ends``     | ``null``
``baseline-eyes-closed_begins`` | ``null``
``baseline-eyes-closed_ends``   | ``null``
``training_begins``             | ``{ "targets": <string> }``
``focus_begins``                | ``{ "target": <int> }``
``focus_ends``                  | ``null``
``block_begins``                | ``{ "target": <int>|null }``
``round_begins``                | ``null``
``flash_begins``                | ``{ "group": <int>, "includes_target": <bool>|null }``
``flash_ends``                  | ``null``
``round_ends``                  | ``null``
``block_ends``                  | ``null``
``training_ends``               | ``null``
``calibration_ends``            | ``null``
``testing_begins``              | ``null``
``testing_ends``                | ``null``
``session_ends``                | ``null``

## Events received from stream ``model``

Label                    | Data
------------------------ | ----
``model-fitting_begins`` | ``null``
``model-fitting_ends``   | ``null``
``model_predicts``       | ``{ "target": <int>, "precision": <float> }``