.PHONY: up down logs test

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f

test:
	python -m unittest discover -s backend -p "test_*.py" -v
	cd frontend && npm ci && npm run lint && npm run test:unit && npm run build
