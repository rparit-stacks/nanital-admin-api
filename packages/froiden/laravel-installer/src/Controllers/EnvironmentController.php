<?php

namespace Froiden\LaravelInstaller\Controllers;

use Illuminate\Routing\Controller;
use Froiden\LaravelInstaller\Helpers\EnvironmentManager;
use Froiden\LaravelInstaller\Request\UpdateRequest;

/**
 * Class EnvironmentController
 * @package Froiden\LaravelInstaller\Controllers
 */
class EnvironmentController extends Controller
{

    /**
     * @var EnvironmentManager
     */
    protected $environmentManager;

    /**
     * @param EnvironmentManager $environmentManager
     */
    public function __construct(EnvironmentManager $environmentManager)
    {
        $this->environmentManager = $environmentManager;
    }

    /**
     * Display the Environment page.
     *
     * @return \Illuminate\View\View
     */
    public function environment()
    {
        // Use config(), not env(): after `php artisan config:cache`, env() is null outside config files
        // and the user gets stuck redirecting back to the license step.
        if (!config('app.license_purchase') || !config('app.license_signature')) {
            return redirect()->route('LaravelInstaller::license');
        }

        $envConfig = $this->environmentManager->getEnvContent();

        return view('vendor.installer.environment', compact('envConfig'));
    }

    /**
     * @param UpdateRequest $request
     * @return string
     */
    public function save(UpdateRequest $request)
    {
        $message = $this->environmentManager->saveFile($request);
        return $message;

    }

}
