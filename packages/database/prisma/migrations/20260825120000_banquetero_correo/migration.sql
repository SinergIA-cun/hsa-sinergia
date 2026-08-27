-- El correo del banquetero, y el teléfono como dato de verdad.
--
-- El teléfono se vuelve OBLIGATORIO al dar de alta (lo exige el esquema de la
-- API), pero la columna se queda nullable: los banqueteros que ya existen sin
-- teléfono no se pueden inventar uno, y ponerles NOT NULL con un valor de relleno
-- sería peor —un teléfono falso se ve igual que uno real—. La ficha los marca
-- como incompletos hasta que alguien capture el de verdad.
ALTER TABLE "Banquetero" ADD COLUMN "correo" TEXT;
