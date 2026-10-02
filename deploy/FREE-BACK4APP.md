# Free Back4app deployment for Nero

Back4app currently lists a free Containers plan at $0/month with 0.25 CPU,
256 MB RAM and 100 GB transfer, plus GitHub deployment and custom Docker
containers. The free plan does not require a credit card.

## Create the container

1. Create or sign in to a Back4app account.
2. Open Containers and create a new Container App.
3. Connect the GitHub repository star-phecda/nero.
4. Select branch main and repository root.
5. Keep Auto Deployments OFF for the first cloud WhatsApp session. Nero stores
   its Baileys session in the running container, so an intentional deployment
   should be treated as a possible fresh pairing event.
6. Add the environment variables listed below.
7. Deploy and watch the container logs.

Back4app requires a Dockerfile and an exposed TCP port for Containers.

## Environment variables

Required:

    GEMINI_API_KEY=your-gemini-key
    NERO_PAIRING_NUMBER=234XXXXXXXXXX

Optional:

    NERO_SYNC_FULL_HISTORY=true

NERO_SYNC_FULL_HISTORY defaults to true to preserve Nero's current recap
behavior. Because the free container has 256 MB RAM, set it to false if the
initial WhatsApp history import causes an out-of-memory restart.

## Pair Nero

When the container starts without a saved Baileys session, Nero prints the
WhatsApp pairing code in the deployment logs.

On the phone:

WhatsApp -> Linked devices -> Link a device -> Link with phone number

Enter the code shown by Nero.

Important: stop the old Termux Nero instance before pairing the cloud instance.
Do not run both instances against the same WhatsApp account.

## Health endpoint

The container listens on the platform PORT and responds to:

    /healthz

This gives Back4app a normal web-service port while Nero maintains the
WhatsApp WebSocket connection in the same process.

## Updating Nero

Keep Auto Deployments disabled while using the free session-preservation
setup. Push code to GitHub as normal, then deploy a new commit manually when
you are ready.

A new deployment can mean a new container filesystem, so a new deployment may
require WhatsApp pairing again. This is the main trade-off of using the free
container without separate persistent session storage.
